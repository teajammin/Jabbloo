import { el, type Screen, goHome } from './screens';
import { moveScreen } from './move';
import { requestChoreography, requestJudgement } from '../api';
import { judgePanel } from './judging';
import { getSettings } from '../settings';
import { play } from '../audio';
import type { RoomConnection } from '../net/room';
import {
  battlegrounds, judges, STARTING_HEALTH, type BattlegroundId, type PlayerArt, type RoomState, type Turn,
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
     * Fighters already introduced.
     *
     * A name card belongs to a character's first appearance. Announcing the
     * same two people again every round turns a reveal into a delay.
     */
    const introduced = new Set<string>();
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

        // A player who asked for less motion gets a faster, shorter fight
        // rather than none at all.
        engine.setMotionScale(getSettings().reduceMotion ? 1.8 : 1);

        const stage = new engine.BattleStage({
          parent: stageHost,
          battleground: (current.chosen ?? battlegrounds[0].id) as BattlegroundId,
        });
        // Effects and lettering together: both are needed the moment the
        // first fighter is announced.
        await Promise.all([engine.preloadEffects(), engine.preloadGlyphs()]);
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

      const sides = ['left', 'right'] as const;
      const entering: {
        fighter: import('../engine').Fighter;
        side: 'left' | 'right';
        name: string;
        id: string;
      }[] = [];
      for (const [index, id] of turn.fighters.entries()) {
        const entry = artFor(id);
        const player = playerFor(id);
        if (!player) continue;

        const weapon = entry?.weapons[0];
        const fighter = await engine.Fighter.create({
          name: entry?.character?.name || player.characterName || player.name,
          // The server fills in stand-in artwork for anything nobody drew, so
          // this only fires if a fighter's art never arrived at all — better a
          // placeholder on stage than an empty half of the screen.
          character: entry?.character?.png ?? '/placeholder-character-a.png',
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

        entering.push({ fighter, side, name: fighter.name, id });
      }

      // One at a time, each announced by name: the brief asks for a reveal,
      // and two fighters arriving together is a scene rather than an entrance.
      // They wait offstage until called so nobody is standing around unnamed.
      for (const { fighter, side } of entering) {
        fighter.setPosition(stage.offstageX(side), stage.height * engine.GROUND_Y);
      }
      for (const { fighter, side, name, id } of entering) {
        if (disposed) return;
        if (!introduced.has(id)) {
          introduced.add(id);
          caption.textContent = name;
          await stage.announce(name, side);
          if (disposed) return;
        }
        await stage.enterStage(fighter, side);
      }
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
        // The weapon appears now, with what the player said they would do with
        // it — the choice is the reveal, so nothing is held before it is made.
        bars.get(attackerId)?.setMove(weaponName, move.prompt);
        await attacker.revealWeapon().then();
        caption.textContent = `${attacker.name} will use the ${weaponName} by ${
          move.prompt || 'swinging it like an axe'
        }`;

        play('whoosh');
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
      // Both moves are done: hands empty again until the next choice.
      for (const fighter of onStage.values()) fighter.holsterWeapon();
      for (const bar of bars.values()) bar.clearMove();
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
      // Connected judges only: a judge whose phone has locked would otherwise
      // hold the round open until the clock ran out with nobody scoring.
      if (judges(current).some((p) => p.connected)) return;

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

    /**
     * One pass of the state machine at a time.
     *
     * Each pass can take seconds — two fighters are announced and walk on, an
     * exchange is choreographed and played — while state keeps arriving. Two
     * passes overlapping would put two animations on the same fighter at once:
     * a player who wrote their move quickly could have their attack start
     * while their character was still walking into the arena, each tween
     * fighting the other for the same position.
     */
    let queue: Promise<void> = Promise.resolve();
    function sync(): Promise<void> {
      queue = queue.then(() => syncOnce()).catch((error: unknown) => {
        // One failed pass must not stop every pass after it.
        console.error('[battle]', error);
      });
      return queue;
    }

    async function syncOnce(): Promise<void> {
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
          const names = turn.fighters.map((id) => {
            const name = artFor(id)?.character?.name || playerFor(id)?.name || '—';
            // A bot playing for someone is worth saying out loud, or the room
            // spends the round wondering why they are attacking like that.
            return playerFor(id)?.connected === false ? `${name} (bot)` : name;
          });
          caption.textContent = 'Entering the arena…';
          await setUpFighters(turn);
          if (disposed) return;
          caption.textContent = `${names[0]} versus ${names[1]}`;
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
        play('hit');
        // The number over the head of whoever took it, before the bar moves —
        // the bar is the running total, this is the hit itself.
        for (const id of turn.fighters) {
          const defenderId = turn.fighters.find((other) => other !== id);
          const dealt = turn.damage[id] ?? 0;
          const defender = defenderId ? onStage.get(defenderId) : null;
          if (defender && ready) ready.stage.showDamage(defender, dealt);
        }
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

  const handle = (state: RoomState): void => {
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
  };

  connection.on({ onClosed: () => goHome(go), onState: handle });

  // Acted on immediately as well as on every update: a phone arriving here
  // from its own move screen during an ULT would otherwise sit on "watch the
  // big screen" until the next broadcast, which can be most of a minute away.
  if (connection.state) handle(connection.state);
}
