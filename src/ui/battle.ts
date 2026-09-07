import { el, type Screen } from './screens';
import { moveScreen } from './move';
import { requestChoreography } from '../api';
import type { RoomConnection } from '../net/room';
import {
  type BattlegroundId, type PlayerArt, type RoomState, type Turn,
} from '../shared/protocol';

/**
 * The battle stage.
 *
 * Drawn on the host screen only, per the brief — phones are controllers. The
 * engine is imported lazily: Pixi is larger than the rest of the app put
 * together, and a phone that only ever shows a prompt box should never
 * download it.
 *
 * This is where the two halves built separately finally meet: a player's fifty
 * words go to the choreographer, and the JSON that comes back drives the
 * canvas.
 */
export function battleScreen(connection: RoomConnection, isHost: boolean): Screen {
  return (root, go) => {
    if (!isHost) return phoneView(connection, go, root);

    let disposed = false;
    let art: PlayerArt[] | null = null;
    let state: RoomState | null = connection.state;

    /** Set once the stage exists; everything else waits on it. */
    let ready: {
      stage: import('../engine').BattleStage;
      engine: typeof import('../engine');
    } | null = null;
    /** Fighters currently on stage, by player id. */
    let onStage = new Map<string, import('../engine').Fighter>();
    /** Turns already played, so a re-broadcast never replays one. */
    let playedTurn = '';
    /**
     * In-flight stage build.
     *
     * ensureStage awaits an import, so two state updates arriving together can
     * both pass its guard and build a second stage on top of the first.
     * Holding the promise makes the second caller wait on the first.
     */
    let building: Promise<void> | null = null;

    const stageHost = el('div', { class: 'battle-stage' });
    const caption = el('p', { class: 'battle-caption' }, 'Bringing the fighters in…');
    root.append(el('main', { class: 'screen screen-battle' }, stageHost, caption));

    const artFor = (id: string) => art?.find((a) => a.playerId === id) ?? null;
    const playerFor = (id: string) => state?.players.find((p) => p.id === id) ?? null;

    function ensureStage(current: RoomState): Promise<void> {
      if (ready || disposed) return Promise.resolve();
      if (building) return building;

      building = (async () => {
        const engine = await import('../engine');
        if (disposed) return;

        const stage = new engine.BattleStage({
          parent: stageHost,
          battleground: (current.chosen ?? 'meadow') as BattlegroundId,
        });
        await engine.preloadEffects();
        if (disposed) { stage.destroy(); return; }

        ready = { stage, engine };
      })();

      return building;
    }

    /**
     * Puts the turn's two fighters on stage.
     *
     * Rebuilt per turn because tag team swaps who is out there; a 1v1 simply
     * has the same two every time, and rebuilding costs nothing at that size.
     */
    async function setUpFighters(turn: Turn): Promise<void> {
      if (!ready || disposed) return;
      const { stage, engine } = ready;

      for (const fighter of onStage.values()) {
        stage.removeFighter(fighter);
        fighter.destroy();
      }
      onStage = new Map();

      const sides = ['left', 'right'] as const;
      for (const [index, id] of turn.fighters.entries()) {
        const entry = artFor(id);
        const player = playerFor(id);
        if (!entry?.character || !player) continue;

        const weapon = entry.weapons[0];
        const fighter = await engine.Fighter.create({
          name: entry.character.name || player.name,
          character: entry.character.png,
          // A player who never drew a weapon still fights, with the standard
          // one the brief falls back to elsewhere.
          weapon: weapon?.png ?? '/placeholder-weapon-sword.png',
          weaponName: weapon?.name ?? 'Sword',
        });
        if (disposed) { fighter.destroy(); return; }
        stage.addFighter(fighter, sides[index]!);
        onStage.set(id, fighter);
      }
    }

    /**
     * Plays one exchange: both moves, in the order the server drew.
     *
     * Each is choreographed as it comes up rather than both up front. The
     * second player's animation has a whole first move to be fetched during,
     * so the wait is free, and a failure only costs the move it belongs to.
     */
    async function playTurn(turn: Turn): Promise<void> {
      if (!ready || disposed) return;
      const { stage, engine } = ready;

      const [a, b] = turn.fighters;
      const order = turn.first === b ? [b, a] : [a, b];

      for (const attackerId of order) {
        if (disposed) return;
        const defenderId = order.find((id) => id !== attackerId)!;
        const attacker = onStage.get(attackerId);
        const defender = onStage.get(defenderId);
        const move = turn.moves[attackerId];
        const entry = artFor(attackerId);
        if (!attacker || !defender || !move) continue;

        const weapon = entry?.weapons[move.weapon];
        if (weapon) await attacker.setWeapon(weapon.png, weapon.name);
        if (disposed) return;

        const weaponName = weapon?.name ?? attacker.weaponName;
        caption.textContent = `${attacker.name} will use the ${weaponName} by ${
          move.prompt || 'swinging it like an axe'
        }`;

        const response = await requestChoreography({
          prompt: move.prompt || 'swing the weapon at them',
          characterName: attacker.name,
          weaponName,
          enemyName: defender.name,
        });
        if (disposed) return;

        const playback = engine.playChoreography(
          { actor: attacker, enemy: defender, stage },
          engine.parseChoreography(response.choreography),
        );
        await playback.finished;
      }

      if (disposed) return;
      caption.textContent = 'Nice.';
      connection.send({ type: 'turnDone' });
    }

    /** One pass of the state machine, driven by whatever the server says. */
    async function sync(): Promise<void> {
      if (disposed || !state || !art) return;
      await ensureStage(state);
      if (disposed || !ready) return;

      const turn = state.turn;
      if (!turn) return;

      const key = `${turn.fighters.join('-')}:${turn.phase}`;
      if (turn.phase === 'picking') {
        if (playedTurn !== key) {
          playedTurn = key;
          await setUpFighters(turn);
          const names = turn.fighters.map((id) => onStage.get(id)?.name ?? '—');
          caption.textContent = `${names[0]} versus ${names[1]}`;
        }
        return;
      }

      if (turn.phase === 'playing' && playedTurn !== key) {
        playedTurn = key;
        await playTurn(turn);
      }
    }

    connection.on({
      onArt: (next) => { art = next; void sync(); },
      onState: (next) => { state = next; void sync(); },
    });

    // The host pulls the artwork; it is far too large to broadcast.
    connection.send({ type: 'requestArt' });

    return () => {
      disposed = true;
      for (const fighter of onStage.values()) fighter.destroy();
      ready?.stage.destroy();
    };
  };
}

/** The phone's view: waiting, until it is this player's turn to write. */
function phoneView(
  connection: RoomConnection,
  go: (screen: Screen) => void,
  root: HTMLElement,
): void {
  root.append(
    el('main', { class: 'screen' },
      el('h1', { class: 'creation-title' }, 'Watch the big screen'),
      el('p', { class: 'lede' }, 'Your turn will appear here when it comes.'),
    ),
  );

  let showing = false;
  connection.on({
    onState: (state) => {
      const turn = state.turn;
      const me = state.players.find((p) => p.id === connection.playerId);
      if (!turn || !me || !turn.fighters.includes(me.id)) return;

      // Swapped in only on the way into a turn, so a state update arriving
      // mid-sentence never rebuilds the screen and wipes what was typed.
      if (turn.phase === 'picking' && !showing) {
        showing = true;
        const weapons = (me.weaponNames.length ? me.weaponNames : ['Sword', 'Axe', 'Hammer'])
          .map((name) => ({ name: name || 'Weapon' }));
        go(moveScreen(connection, weapons, me.characterName || me.name));
      }
    },
  });
}
