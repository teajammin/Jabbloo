import { el, type Screen } from './screens';
import { moveScreen } from './move';
import { requestChoreography, requestJudgement } from '../api';
import { judgePanel } from './judging';
import type { RoomConnection } from '../net/room';
import {
  judges, STARTING_HEALTH, type BattlegroundId, type PlayerArt, type RoomState, type Turn,
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
    /** Their health bars, kept alongside so damage can be shown as it lands. */
    let bars = new Map<string, import('../engine').HealthBar>();
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
      stage.clearHealthBars();
      bars = new Map();

      const entrances: Promise<void>[] = [];
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
        const side = sides[index]!;
        stage.addFighter(fighter, side);
        onStage.set(id, fighter);

        const bar = new engine.HealthBar(fighter.name, side);
        bar.setHealth(player.health, STARTING_HEALTH, false);
        stage.addHealthBar(bar, side);
        bars.set(id, bar);

        entrances.push(stage.enterStage(fighter, side));
      }

      // Both walk on together — one after the other doubles the wait for no
      // extra ceremony.
      await Promise.all(entrances);
    }

    /** Moves every bar to the health the server last reported. */
    function refreshHealth(current: RoomState): void {
      for (const [id, bar] of bars) {
        const player = current.players.find((p) => p.id === id);
        if (player) bar.setHealth(player.health, STARTING_HEALTH);
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
      caption.textContent = 'Judging…';
      connection.send({ type: 'turnPlayed' });
    }

    /**
     * Scores the exchange when nobody else can.
     *
     * Only in a two-player game: the brief gives judges the job wherever there
     * are any, and the host stepping in there would override them.
     */
    async function judgeWithAi(turn: Turn, current: RoomState): Promise<void> {
      if (judges(current).length > 0) return;

      for (const attackerId of turn.fighters) {
        if (disposed) return;
        const attacker = onStage.get(attackerId);
        const defenderId = turn.fighters.find((id) => id !== attackerId)!;
        const defender = onStage.get(defenderId);
        const move = turn.moves[attackerId];
        if (!attacker || !defender || !move) continue;

        const entry = artFor(attackerId);
        const verdict = await requestJudgement({
          prompt: move.prompt,
          characterName: attacker.name,
          weaponName: entry?.weapons[move.weapon]?.name ?? attacker.weaponName,
          enemyName: defender.name,
        });
        if (disposed) return;
        connection.send({ type: 'submitNote', attackerId, note: verdict.reason });
        connection.send({ type: 'submitScore', attackerId, score: verdict.score });
      }
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
          // Named before the entrance rather than after it, so the caption is
          // already up while the two of them walk on.
          const names = turn.fighters.map(
            (id) => artFor(id)?.character?.name || playerFor(id)?.name || '—',
          );
          caption.textContent = `${names[0]} versus ${names[1]}`;
          await setUpFighters(turn);
        }
        return;
      }

      if (turn.phase === 'playing' && playedTurn !== key) {
        playedTurn = key;
        await playTurn(turn);
        return;
      }

      if (turn.phase === 'judging' && playedTurn !== key) {
        playedTurn = key;
        await judgeWithAi(turn, state);
        return;
      }

      if (turn.phase === 'over' && playedTurn !== key) {
        playedTurn = key;
        refreshHealth(state);
        showDamage(turn);
        // A beat to read the damage before the next pair walk on.
        setTimeout(() => {
          if (!disposed) connection.send({ type: 'turnDone' });
        }, 2600);
      }
    }

    /** Shows what each move cost, so the score is visible, not just felt. */
    function showDamage(turn: Turn): void {
      const lines = turn.fighters.map((id) => {
        const name = onStage.get(id)?.name ?? '—';
        const dealt = turn.damage[id] ?? 0;
        const note = turn.notes[id];
        return `${name} dealt ${dealt}${note ? ` — ${note}` : ''}`;
      });
      caption.textContent = lines.join('   ·   ');
    }

    connection.on({
      onArt: (next) => { art = next; void sync(); },
      onState: (next) => {
        state = next;
        if (next.phase === 'ult') {
          void import('./creation').then(({ creationScreen }) => {
            go(creationScreen(connection, true));
          });
          return;
        }
        if (next.phase === 'results') {
          void import('./results').then(({ resultsScreen }) => {
            go(resultsScreen(connection, true));
          });
          return;
        }
        void sync();
      },
    });

    // The host pulls the artwork; it is far too large to broadcast.
    connection.send({ type: 'requestArt' });

    return () => {
      disposed = true;
      for (const fighter of onStage.values()) fighter.destroy();
      ready?.stage.clearHealthBars();
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
  const panel = judgePanel(connection);
  const waiting = el('p', { class: 'lede' }, 'Your turn will appear here when it comes.');

  root.append(
    el('main', { class: 'screen' },
      el('h1', { class: 'creation-title' }, 'Watch the big screen'),
      waiting,
      panel.root,
    ),
  );

  let showing = false;
  connection.on({
    onState: (state) => {
      if (state.phase === 'ult') {
        void import('./creation').then(({ creationScreen }) => {
          go(creationScreen(connection, false));
        });
        return;
      }
      if (state.phase === 'results') {
        void import('./results').then(({ resultsScreen }) => {
          go(resultsScreen(connection, false));
        });
        return;
      }
      panel.update(state);
      waiting.hidden = !panel.root.hidden;

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
