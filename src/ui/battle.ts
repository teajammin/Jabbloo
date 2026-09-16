import { el, type Screen, goHome } from './screens';
import { moveScreen } from './move';
import { requestChoreography, requestJudgement } from '../api';
import { judgePanel } from './judging';
import { getSettings } from '../settings';
import { report } from '../errors';
import { loadingBadge } from './loading';
import { play } from '../audio';
import { narrate, hush, say, preloadLines } from './narrator';
import { describeBeats } from './commentary';
import type { RoomConnection } from '../net/room';
import {
  battlegrounds, graceExpired, isFinalRound, judges, STARTING_HEALTH, type BattlegroundId, type PlayerArt, type RoomState, type Turn,
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
     * Whether this screen arrived after the fight had already begun.
     *
     * A reload puts the big screen back into a round that is already running,
     * and the full entrance — each fighter named, then VERSUS — is a ceremony
     * for a start that happened minutes ago. It reads as the game beginning
     * again, which is alarming when it is not. Coming back gets the fighters
     * in place and a single FIGHT, and then carries on.
     */
    let resumed: boolean | null = null;
    /** Taken down on teardown, so leaving mid-load does not strand it. */
    let loading: { done: () => void } | null = null;
    /** The final-round warning is worth one interruption, not one per round. */
    let saidFinalRound = false;
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

    /**
     * Which game this is, and which screen is asking.
     *
     * The backend takes these to the room before spending a model call, so
     * the endpoints are not a bill anybody with the URL can run up.
     */
    const credentials = () => ({
      room: state?.code ?? '',
      device: connection.playerId ?? '',
    });

    const artFor = (id: string) => art?.find((a) => a.playerId === id) ?? null;
    const playerFor = (id: string) => state?.players.find((p) => p.id === id) ?? null;

    function ensureStage(current: RoomState): Promise<void> {
      if (ready || disposed) return Promise.resolve();
      if (building) return building;

      /*
       * The one wait in the game worth announcing.
       *
       * A renderer, fifty-seven effect sprites, thirty letters, a photograph
       * and everyone's artwork, all before there is anything on the stage to
       * look at. Everything else in this file happens between frames.
       */
      const badge = loadingBadge();
      document.body.appendChild(badge.root);
      loading = badge;

      building = (async () => {
        const engine = await import('../engine');
        if (disposed) return;

        // A battleground that fails to load is invisible on screen: the stage
        // simply stays the flat colour underneath. Sending those failures to
        // the crash log is the only way anyone finds out.
        engine.reportAssetFailures((url, error) => {
          report(new Error(`asset failed: ${url} — ${String(error).slice(0, 120)}`));
        });
        // Initialised once, before anything asks for a texture: several loads
        // racing the loader's own start-up is how a battleground quietly
        // failed to appear.
        await engine.prepareAssets();
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
        // The narrator's recordings ride along with the rest: half a megabyte
        // once, so no line ever arrives late to its own beat.
        preloadLines();
        await Promise.all([engine.preloadEffects(), engine.preloadGlyphs()]);
        if (disposed) { stage.destroy(); return; }

        ready = { stage, engine };

        /*
         * A door onto the arena, for a driving script — and only when asked.
         *
         * Every report of a move that "did not animate" is about this stage,
         * and there is no way to check one from outside: the effects are
         * sprites in a WebGL scene, not elements anything can query. A harness
         * that can ask the running stage what is on it is the difference
         * between fixing that class of bug and guessing at it.
         *
         * Behind ?debug, so an ordinary game never exposes anything.
         */
        if (new URLSearchParams(location.search).has('debug')) {
          const w = window as unknown as { __stage: unknown; __battle: unknown };
          w.__stage = stage;
          // Enough to tell "the renderer is broken" from "the move was never
          // played", which look identical from outside and are not the same
          // bug at all.
          w.__battle = {
            onStage: () => [...onStage.keys()],
            // Who is currently poisoned, burnt or cursed — the one question
            // that cannot be answered from outside a WebGL scene, and the one
            // a move aimed at the wrong fighter gets wrong.
            tints: () => Object.fromEntries(
              [...onStage.entries()].map(([id, f]) => [id, f.tint]),
            ),
            // Where the bars and their portraits actually sit, which is the
            // one thing a screenshot shows and nothing else can measure.
            bars: () => [...bars.entries()].map(([id, bar]) => {
              const box = bar.getBounds();
              return {
                id,
                left: Math.round(box.x),
                right: Math.round(box.x + box.width),
                stage: Math.round(stage.width),
              };
            }),
            art: () => (art ?? []).map((a) => `${a.playerId}:${a.weapons.length}w`),
            turn: () => state?.turn,
          };
        }
      })().finally(() => {
        // Whatever happened — ready, or failed and falling back to the flat
        // colour — the room is no longer waiting on it.
        badge.done();
        if (loading === badge) loading = null;
      });

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

      // Already out there? Then they stay out there.
      //
      // In a one-a-side game the same two people fight every round, and
      // walking them off and back on between rounds is ceremony for a change
      // that has not happened. Tag team is the case this exists for: there,
      // the pair really is different and the entrance says who is up.
      const sameAsBefore = turn.fighters.every((id) => onStage.has(id))
        && onStage.size === turn.fighters.length;
      if (sameAsBefore) {
        for (const fighter of onStage.values()) {
          fighter.resetPose();
          fighter.holsterWeapon();
        }
        for (const bar of bars.values()) bar.clearMove();
        refreshHealth(state!);
        return;
      }

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

        // Their own photograph, if they brought one, at the outer edge of the
        // bar — so the room can tell at a glance whose health it is watching.
        const bar = new engine.HealthBar(
          fighter.name, side, undefined,
          ...(player.photo ? [player.photo] as const : []),
        );
        bar.setHealth(player.health, STARTING_HEALTH, false);
        stage.addHealthBar(bar, side);
        bars.set(id, bar);

        entering.push({ fighter, side, name: fighter.name, id });
      }

      /*
       * The sequence between two people appearing and a fight starting.
       *
       * Each fighter is named, then walks on, then the two of them are put
       * against each other, and only then does the fight start. Every beat
       * says what it is — a room watching a big screen should never have to
       * infer that something has changed — and the whole thing is deliberately
       * unhurried: this is the part of a fighting game people look forward to.
       */
      for (const { fighter, side } of entering) {
        fighter.setPosition(stage.offstageX(side), stage.height * engine.GROUND_Y);
      }

      /*
       * The opening: one fighter, the word between them, the other, the call.
       *
       * Only for a pair the room has not seen before. In a one-a-side game
       * that is round one and nothing after it — announcing the same two
       * people against each other before every exchange turns the moment into
       * furniture, and it was doing exactly that.
       */
      const opening = entering.some(({ id }) => !introduced.has(id)) && resumed !== true;

      for (const [index, { fighter, side, name, id }] of entering.entries()) {
        if (disposed) return;
        introduced.add(id);

        if (opening) {
          caption.textContent = `${name} steps up`;
          await stage.announce(name, side);
          if (disposed) return;
        }

        await stage.enterStage(fighter, side);
        if (disposed) return;

        // Between the first and the second, the word that sets them against
        // each other.
        if (opening && index === 0 && entering.length > 1) {
          caption.textContent = `${name} versus…`;
          await stage.proclaim('versus', 0.9);
          if (disposed) return;
        }
      }

      if (disposed) return;

      // The call to fight, whether this is the start or a screen catching up.
      if (opening || resumed === true) {
        resumed = false;
        caption.textContent = 'Fight!';
        say('fight');
        await stage.proclaim('fight', 0.9);
        if (disposed) return;
      }
      if (!disposed) stage.shake(7, 0.4);
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

      /*
       * Nobody fights from off stage.
       *
       * The fighters are put out during the picking phase, which assumes the
       * screen was watching when it happened. A host whose arena was still
       * loading when both moves landed never sees that phase — and neither
       * does one that reloaded mid-round, or one in a game where bots answered
       * instantly — so the stage stayed empty and every move was skipped by
       * the guard below: no choreography even requested, no effect, no sound,
       * nothing to see. The round simply passed.
       *
       * This is free when they are already out there: setting up the same pair
       * again resets their pose and returns.
       */
      await setUpFighters(turn);
      if (disposed) return;

      const [a, b] = turn.fighters;
      const order = turn.first === b ? [b, a] : [a, b];

      /*
       * A rule nobody is told about is a rule nobody plays to — but it only
       * needs saying once. The fighters do not change between the rounds of a
       * duel, so unlike the opening this cannot ride on an entrance.
       */
      if (isFinalRound(state!) && !saidFinalRound) {
        saidFinalRound = true;
        caption.textContent = 'Final round — every hit counts double';
        say('final');
        await stage.proclaim('final round', 1.3);
        if (disposed) return;
      }

      /*
       * The weapons, announced one after the other before anything swings.
       *
       * Both of them, then the fight — rather than a name, a move, a name, a
       * move. It is the last beat of anticipation the round has, and reading
       * out what each of them is about to hold is most of the fun of having
       * drawn it.
       */
      for (const attackerId of order) {
        if (disposed) return;
        const attacker = onStage.get(attackerId);
        const move = turn.moves[attackerId];
        const entry = artFor(attackerId);
        if (!attacker || !move) continue;

        const weapon = entry?.weapons[move.weapon];
        if (weapon) await attacker.setWeapon(weapon.png, weapon.name);
        if (disposed) return;

        const weaponName = weapon?.name ?? attacker.weaponName;
        bars.get(attackerId)?.setMove(weaponName, move.prompt);
        await attacker.revealWeapon().then();
        if (disposed) return;

        const billing = `${attacker.name} will use the ${weaponName}`;
        caption.textContent = billing;
        play('whoosh');
        // The card carries the names, which no recording can; the voice reads
        // them too where the device happens to have speech of its own.
        await Promise.all([
          stage.proclaim(billing, 1.5),
          narrate(billing),
        ]);
        if (disposed) return;
      }

      for (const attackerId of order) {
        if (disposed) return;
        const defenderId = order.find((id) => id !== attackerId)!;
        const attacker = onStage.get(attackerId);
        const defender = onStage.get(defenderId);
        const move = turn.moves[attackerId];
        const entry = artFor(attackerId);
        if (!attacker || !defender || !move) continue;

        const weaponName = entry?.weapons[move.weapon]?.name ?? attacker.weaponName;
        const response = await requestChoreography({
          prompt: move.prompt || 'swing the weapon at them',
          characterName: attacker.name,
          weaponName,
          enemyName: defender.name,
          ...credentials(),
        });
        if (disposed) return;

        /*
         * The commentary runs with the move, not before it.
         *
         * Each step says what it is as it happens — the choreography's own
         * beats are the script, so the voice lands on the swing rather than
         * describing it afterwards. The caption keeps pace for anyone who has
         * the sound off.
         */
        const parsed = engine.parseChoreography(response.choreography);
        const beats = describeBeats(parsed, attacker.name, defender.name, weaponName);

        const playback = engine.playChoreography(
          { actor: attacker, enemy: defender, stage },
          parsed,
          {
            onStep: (index) => {
              const beat = beats[index];
              if (!beat) return;
              if (beat.caption) caption.textContent = beat.caption;
              // The game's own voice, the same on every machine.
              if (beat.line) say(beat.line);
            },
          },
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
          ...credentials(),
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

      /*
       * Decided once, from the first round this screen ever sees.
       *
       * Arriving at anything other than the opening moments of the first round
       * means the fight was already under way — a reload, a host coming back,
       * a screen opened late — and the entrance belongs to a beginning that
       * has already happened.
       */
      if (resumed === null && turn) {
        resumed = turn.index > 0 || turn.phase !== 'picking';
      }
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
            const fighter = playerFor(id);
            return fighter && graceExpired(fighter) ? `${name} (BOT)` : name;
          });
          caption.textContent = 'Entering the arena…';
          await setUpFighters(turn);
          if (disposed) return;
          caption.textContent = `${names[0]} versus ${names[1]} — pick your weapon`;
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
      hush();
      // Leaving mid-load must not leave the badge behind: it is on <body>, so
      // nothing else would ever take it down.
      loading?.done();
      loading = null;

      /*
       * The debug hooks go with the stage they describe.
       *
       * They hang off `window`, so nothing else would ever drop them — and
       * what they hold is not small: a destroyed Pixi stage with its textures,
       * every fighter, and every player's artwork as base64. Left in place
       * they would pin all of it for the life of the tab, through every
       * rematch and new game, on the one screen in this game that has actually
       * run a browser out of memory.
       */
      const w = window as unknown as { __stage?: unknown; __battle?: unknown };
      // Only if they still describe this screen. The battle screen can be
      // rebuilt while a fight is running, and an outgoing instance clearing
      // the incoming one's hooks would leave the harness blind to the very
      // thing it was watching.
      if (ready && w.__stage === ready.stage) {
        delete w.__stage;
        delete w.__battle;
      }
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
  // from its own move screen during an Ultimate would otherwise sit on "watch the
  // big screen" until the next broadcast, which can be most of a minute away.
  if (connection.state) handle(connection.state);
}
