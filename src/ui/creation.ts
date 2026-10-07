import { setTrack } from '../music';
import { el, button, type Screen, goHome } from './screens';
import { countdown } from './timer';
import { drawScreen } from './drawScreen';
import { battlegroundScreen } from './battleground';
import { play } from '../audio';
import type { RoomConnection } from '../net/room';
import {
  creators, displayName, graceExpired, longestRemaining, standIn, stepsFor, stillWorking,
  OFFENSIVE_BONUS, WEAPON_COUNT, budgetFor,
  type Player, type RoomState, type WeaponKind,
} from '../shared/protocol';

/**
 * Character and weapon creation.
 *
 * One screen for the whole phase, swapping between drawing and naming as the
 * server moves the step on. Rebuilding a screen per step would throw away the
 * canvas mid-phase and lose anything not yet submitted.
 *
 * Judges and the host get their own views: neither creates anything, and the
 * brief gives them each a different job while they wait.
 */

export function creationScreen(connection: RoomConnection, isHost: boolean): Screen {
  return (root, go) => {
    if (isHost) setTrack('theme');

    let lastStep = '';
    /** Set once this screen has handed over, so it cannot hand over twice. */
    let leaving = false;

    /*
     * Where the player is, decided here rather than by the server.
     *
     * Creation used to be a queue the room walked everybody through, so the
     * screen only had to render whichever step the server said they were on.
     * With a pooled budget the order is the player's: they pick a slot, draw,
     * name it, and come back to the library. Only this device knows which of
     * those they are doing, so only this device can route it.
     */
    let view: 'library' | 'draw' | 'name' = 'library';
    let activeSlot = '';
    /*
     * What was drawn, kept per slot.
     *
     * One variable for "the drawing" was wrong the moment a player skipped a
     * step: it still held the last thing they *had* drawn, so the naming step
     * for a weapon they never got to showed them their character, or the
     * weapon before it, and asked them to name that.
     */
    const drawnBySlot = new Map<string, string>();

    /**
     * Autosave for the drawing in progress.
     *
     * The brief says a player who drops keeps their work as last touched, and
     * the same rule saves anyone who simply runs out of time: the step ends,
     * whatever is on the canvas is sent, and they fight as what they drew
     * rather than as a placeholder.
     */
    let readDrawing: (() => string | null) | null = null;
    let pendingSlot: string | null = null;
    let lastSaved = '';
    let saveTimer: number | null = null;

    function flushDrawing(): void {
      if (!pendingSlot || !readDrawing) return;
      const png = readDrawing();
      if (!png || png === lastSaved) return;
      lastSaved = png;
      drawnBySlot.set(pendingSlot, png);
      // Work in progress, not a finished step: `done` is what ends the step.
      connection.send({ type: 'submitDrawing', slot: pendingSlot, png });
    }

    // A phone going to sleep or a tab going to the background is the most
    // likely way work is lost, and neither fires unload reliably.
    const onHide = () => { if (document.visibilityState === 'hidden') flushDrawing(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushDrawing);

    const clock = countdown();
    const heading = el('h1', { class: 'creation-title' }, '');
    const subheading = el('p', { class: 'lede' }, '');
    const body = el('div', { class: 'creation-body' });
    const roster = el('ul', { class: 'roster' });

    /** Submits whatever the current step produced, then waits for the others. */
    const submitDrawing = (png: string, slot: string) => {
      drawnBySlot.set(slot, png);
      lastSaved = png;
      connection.send({ type: 'submitDrawing', slot, png, done: true });
    };

    // --- the drawing step ---------------------------------------------------

    function showDraw(slot: string, prompt: string): void {
      body.replaceChildren();
      const holder = el('div', { class: 'creation-canvas' });
      body.appendChild(holder);

      pendingSlot = slot;
      lastSaved = '';

      // drawScreen is a Screen, so it mounts into a host element of its own.
      const teardown = drawScreen({
        title: prompt,
        embedded: true,
        // Weapons have a business end; a character does not.
        aim: slot.startsWith('weapon'),
        onSnapshot: (read) => { readDrawing = read; },
        onDone: (png) => {
          submitDrawing(png, slot);
          /*
           * Naming always follows making, which is the one piece of order the
           * player does not choose. A thing with no name is a thing the game
           * has to invent a name for, and it is funnier when they do it.
           */
          view = 'name';
          lastStep = '';
          if (connection.state) render(connection.state);
        },
      })(holder, go);

      // Often enough that little is lost, rarely enough that a phone is not
      // uploading a PNG every few seconds all through the step.
      saveTimer = window.setInterval(flushDrawing, 10_000);

      cleanups.push(() => {
        if (saveTimer !== null) { window.clearInterval(saveTimer); saveTimer = null; }
        readDrawing = null;
        pendingSlot = null;
        teardown?.();
      });
    }

    // --- the naming step ----------------------------------------------------

    function showName(slot: string): void {
      body.replaceChildren();

      /*
       * This slot's drawing — or, if there isn't one, the thing they will
       * actually be given.
       *
       * Nothing drawn used to say so in words over an empty box, which tells
       * somebody their work is missing without telling them what happens next.
       * The room fills these in from a table the client can read too, so the
       * honest answer is simply to show it: this is your weapon, name it.
       */
      const drawn = drawnBySlot.get(slot);
      const seat = creators(connection.state ?? { players: [] } as unknown as RoomState)
        .findIndex((p) => p.id === connection.playerId);
      const fallback = standIn(slot, seat < 0 ? 0 : seat);

      const preview = el('img', {
        class: `creation-preview${drawn ? '' : ' is-standin'}`,
        src: drawn ?? fallback.png,
        alt: '',
      });

      const input = el('input', {
        type: 'text', class: 'name-input', maxLength: 24,
        // A slot with no drawing is already a known thing, so the box suggests
        // what it is rather than a joke about something else.
        placeholder: drawn
          ? (slot === 'character' ? 'Sir Bonkalot' : 'Butter Sword')
          : fallback.name,
      });
      input.setAttribute('autocomplete', 'off');

      /*
       * What the weapon is for, asked where it is named.
       *
       * A step of its own would have been cleaner to build and worse to play:
       * creation is already four drawings and four names against a clock, and
       * a fifth screen asking one question would be the one everybody rushes.
       * Beside the name, it is read at the moment the thing becomes a thing.
       *
       * Characters are not asked — only weapons have a job.
       */
      const isWeapon = slot !== 'character';
      let kind: WeaponKind = 'offensive';
      const kindButtons = new Map<WeaponKind, HTMLButtonElement>();

      const kindRow = el('div', { class: 'kind-row' });
      if (isWeapon) {
        for (const [value, label, what] of [
          ['offensive', 'Offensive', `Hits ${OFFENSIVE_BONUS} harder every round`],
          ['defensive', 'Defensive', 'Guards two sides instead of one'],
        ] as const) {
          const node = el('button', { class: `kind-pick is-${value}`, type: 'button' },
            el('span', { class: 'kind-name' }, label),
            el('span', { class: 'kind-what' }, what));
          node.setAttribute('aria-pressed', String(value === kind));
          node.addEventListener('click', () => {
            kind = value;
            for (const [other, button_] of kindButtons) {
              button_.setAttribute('aria-pressed', String(other === value));
            }
          });
          kindButtons.set(value, node);
          kindRow.appendChild(node);
        }
      }

      const send = () => {
        connection.send({
          type: 'submitName',
          slot,
          name: input.value,
          ...(isWeapon ? { kind } : {}),
        });
        // Back to the page, where the thing they just made is now a sticker.
        view = 'library';
        activeSlot = '';
        lastStep = '';
        if (connection.state) render(connection.state);
      };

      const form = el('form', { class: 'stack' },
        input,
        ...(isWeapon ? [
          el('p', { class: 'kind-ask' }, 'What is it for?'),
          kindRow,
        ] : []),
        button('Save', send, 'big primary'));
      form.addEventListener('submit', (event) => { event.preventDefault(); send(); });

      body.append(preview, ...(drawn ? [] : [
        el('p', { class: 'help-note' }, slot === 'character'
          ? 'Nothing drawn, so this one is fighting for you. Give it a name.'
          : `Nothing drawn, so you get this ${fallback.name}. Name it anyway.`),
      ]), form);
      input.focus();
    }


    // --- watchers and judges ------------------------------------------------

    function showJudge(): void {
      body.replaceChildren(
        el('p', { class: 'lede' }, 'Relax while your friends create questionable things.'),
        roster,
      );
    }

    function showHost(): void {
      body.replaceChildren(
        el('p', { class: 'lede' }, 'Create your characters and weapons.'),
        roster,
      );
    }

    // --- the sticker library -------------------------------------------------

    /**
     * Everything this player can make, and what is in each slot.
     *
     * The character first and wider, because it is the thing that fights and
     * the only slot whose order is fixed — a weapon held by nobody is not
     * something anyone can place. The weapons after it, either of which may be
     * left empty: one weapon is enough to fight, and somebody who spends their
     * whole budget on a character they love should not be stopped.
     */
    function slotsFor(state: RoomState): { slot: string; label: string; wide: boolean }[] {
      if (state.phase === 'ult') {
        const index = WEAPON_COUNT + Math.max(0, state.ultRound - 1);
        return [{ slot: `weapon${index}`, label: 'Your Ultimate', wide: true }];
      }
      return [
        { slot: 'character', label: 'Your fighter', wide: true },
        ...Array.from({ length: WEAPON_COUNT }, (_, i) => ({
          slot: `weapon${i}`,
          label: i === 0 ? 'First weapon' : 'Second weapon',
          wide: false,
        })),
      ];
    }

    function nameOf(slot: string, me: Player): string {
      if (slot === 'character') return me.characterName;
      const index = Number(slot.replace('weapon', ''));
      return me.weaponNames[index] ?? '';
    }

    /**
     * The library: a page of die-cut stickers the player fills at their own pace.
     *
     * A filled slot shows the drawing with its name on a chip above it, pressed
     * on at a slight angle. An empty one is the die line with no stock — a space
     * waiting to be peeled into. Tapping either one goes there: an empty slot to
     * make it, a filled one to redraw it while there is still time.
     */
    function showLibrary(state: RoomState, me: Player): void {
      body.replaceChildren();

      const slots = slotsFor(state);
      const hasCharacter = state.phase === 'ult' || Boolean(drawnBySlot.get('character'))
        || me.progress.drawn.includes('character');

      const page = el('div', { class: 'library' });
      for (const { slot, label, wide } of slots) {
        const png = drawnBySlot.get(slot);
        const name = nameOf(slot, me);
        const filled = Boolean(png);
        /*
         * A weapon cannot be made before the fighter who holds it.
         *
         * Not an arbitrary order: the placement step that follows asks where on
         * the character the weapon sits, and there is nothing to put it on
         * until the character exists.
         */
        const locked = !filled && !hasCharacter && slot !== 'character';

        const tile = el('button', {
          class: `lib-slot sticker${filled ? ' is-tilted' : ' is-empty'}`
            + (wide ? ' is-wide' : '') + (locked ? ' is-locked' : ''),
          type: 'button',
        });
        tile.disabled = locked;

        if (filled) {
          tile.append(
            el('img', { class: 'lib-art', src: png!, alt: '' }),
            el('span', { class: 'lib-name' }, name || 'Tap to name'),
          );
          tile.setAttribute('aria-label', `${label}: ${name || 'unnamed'}. Tap to redraw.`);
        } else {
          tile.append(
            el('span', { class: 'lib-plus' }, '+'),
            el('span', { class: 'lib-label' }, locked ? 'Fighter first' : label),
          );
          tile.setAttribute('aria-label', locked ? `${label}, locked until you draw your fighter` : `Make ${label}`);
        }

        tile.addEventListener('click', () => {
          if (locked) return;
          play('click');
          activeSlot = slot;
          view = 'draw';
          lastStep = '';
          render(connection.state ?? state);
        });

        page.appendChild(tile);
      }

      const done = button('Done', () => {
        play('click');
        flushDrawing();
        connection.send({ type: 'creationDone' });
      }, 'big primary lib-done');
      done.disabled = !hasCharacter;
      done.title = hasCharacter
        ? 'Finish early and wait for the others'
        : 'Draw your fighter first';

      body.append(page, el('div', { class: 'lib-actions' }, done));
    }

    // --- rendering ----------------------------------------------------------

    const cleanups: (() => void)[] = [];

    /** What one player is up to, in the fewest words that say it. */
    function describeProgress(player: Player, state: RoomState): string {
      if (!player.connected) {
        return graceExpired(player) ? 'away' : 'reconnecting…';
      }
      if (player.progress.done) return 'finished';

      const step = stepsFor(state)[player.progress.step];
      const left = Math.max(0, Math.ceil((player.progress.endsAt - Date.now()) / 1000));
      if (!step) return 'finishing';
      return `${step.prompt.toLowerCase()} · ${left}s`;
    }

    function renderRoster(state: RoomState): void {
      roster.replaceChildren();
      for (const player of creators(state)) {
        const row = el('li', { class: `player${player.progress.done ? ' is-ready' : ''}` },
          el('span', { class: 'avatar placeholder' }, player.name.slice(0, 1).toUpperCase()),
          el('span', { class: 'player-name' }, displayName(player)),
          // Saying a player has gone matters more than saying they are busy:
          // it explains why a bot is about to play their turns.
          el('span', { class: 'you' }, describeProgress(player, state)),
        );
        roster.appendChild(row);
      }
    }

    /**
     * What the player is looking at, given where they have got to.
     *
     * Each player walks their own path, so this is driven by their own step
     * and their own clock rather than by the room's.
     */
    function render(state: RoomState): void {
      renderRoster(state);

      const me = state.players.find((p) => p.id === connection.playerId);
      const ult = state.phase === 'ult';

      // The host and the judges do not make anything; they watch.
      if (isHost || !me || me.role === 'judge' || me.role === 'unassigned') {
        heading.textContent = ult ? 'Drawing Ultimates' : 'Making characters';
        subheading.textContent = isHost
          ? ult
            ? 'Level on damage — both sides are drawing an Ultimate.'
            : 'Everyone is working at their own pace.'
          : 'Relax while your friends create questionable things.';
        clock.setDeadline(state.stepEndsAt, 0);

        const key = `${state.phase}:watching`;
        if (key === lastStep) return;
        lastStep = key;
        for (const fn of cleanups.splice(0)) fn();
        if (isHost) showHost(); else showJudge();
        return;
      }

      /*
       * Finished, and waiting on the others.
       *
       * Reached by pressing Done or by the budget running out, which the server
       * treats as the same event — so this is the one place anybody waits.
       */
      if (me.progress.done) {
        heading.textContent = 'All done';
        const others = stillWorking(state).filter((p) => p.id !== me.id);
        subheading.textContent = others.length === 0
          ? 'Everyone is ready.'
          : others.length === 1
            ? `Waiting for ${others[0]!.name}.`
            : `Waiting for ${others.length} others.`;
        const wait = waitingClock(state);
        clock.setDeadline(wait.endsAt, wait.total);

        const key = `${state.phase}:${state.ultRound}:waiting`;
        if (key === lastStep) return;
        lastStep = key;
        flushDrawing();
        for (const fn of cleanups.splice(0)) fn();
        showWaitingRoom();
        return;
      }

      /*
       * Their own clock, against the whole budget.
       *
       * One bar draining once, rather than four bars each refilling: the player
       * is spending a pot of time and the bar is how much of the pot is left.
       */
      clock.setDeadline(me.progress.endsAt, budgetFor(state));

      const ultLabel = state.phase === 'ult' ? 'One more weapon' : 'Your sticker library';
      heading.textContent = view === 'draw'
        ? (activeSlot === 'character' ? 'Draw your fighter' : 'Draw a weapon')
        : view === 'name'
          ? (activeSlot === 'character' ? 'Name your fighter' : 'Name it')
          : ultLabel;
      subheading.textContent = view === 'library'
        ? (state.phase === 'ult'
          ? 'The scores are level. One more weapon decides it.'
          : 'The time is yours to spend. Fill a slot, or press Done when you are happy.')
        : '';

      /*
       * Rebuilt only when this player moves, never when somebody else does.
       *
       * The key carries the local view and slot, because the server no longer
       * knows which of the three the player is looking at — and a stroke in
       * progress must survive another player finishing theirs.
       */
      const key = `${state.phase}:${state.ultRound}:${view}:${activeSlot}`;
      if (key === lastStep) return;
      lastStep = key;

      flushDrawing();
      for (const fn of cleanups.splice(0)) fn();

      if (view === 'draw') showDraw(activeSlot, heading.textContent);
      else if (view === 'name') showName(activeSlot);
      else showLibrary(state, me);
      return;
    }

    /*
     * How long the wait has to run, and what the bar is draining against.
     *
     * The deadline moves as people work — somebody finishing early shortens
     * it — so the bar's full length is remembered from when the wait started
     * and only reset when the estimate gets *longer*. Recomputing the total
     * every update would refill the bar every second and it would never
     * appear to move.
     */
    let waitEndsAt = 0;
    let waitTotal = 1;

    function waitingClock(state: RoomState): { endsAt: number; total: number } {
      const now = Date.now();
      const endsAt = now + longestRemaining(state, now);

      if (endsAt > waitEndsAt + 1000 || waitEndsAt === 0) {
        waitEndsAt = endsAt;
        waitTotal = Math.max(1, (endsAt - now) / 1000);
      } else if (endsAt < waitEndsAt) {
        waitEndsAt = endsAt;
      }

      return { endsAt: waitEndsAt, total: waitTotal };
    }

    /**
     * The waiting room.
     *
     * Not a blank screen with a spinner: it says who is still going and how
     * long they have left, so waiting is a thing with an end rather than a
     * thing that might be broken.
     */
    function showWaitingRoom(): void {
      body.replaceChildren(
        el('p', { class: 'lede waiting' },
          'Your character and weapons are in. The game starts when everyone is done.'),
        roster,
      );
    }

    root.append(
      el('main', { class: 'screen screen-creation' }, heading, subheading, clock.root, body),
    );

    connection.on({
      onClosed: () => goHome(go),
      onState: (state) => {
        /*
         * Creation now ends in placing rather than in the vote.
         *
         * Guarded by `leaving` like the others: the handover waits on a dynamic
         * import, state keeps arriving while that is in flight, and without the
         * guard a second screen gets mounted on top of the first.
         */
        if (state.phase === 'placing' && !leaving) {
          leaving = true;
          clock.stop();
          void (async () => {
            const { placingScreen } = await import('./placing');
            go(placingScreen(connection, isHost));
          })();
          return;
        }
        if (state.phase === 'battleground') {
          clock.stop();
          go(battlegroundScreen(connection, isHost));
          return;
        }
        /*
         * An ULT runs straight into the fight on the ground already chosen.
         *
         * Guarded, because the handover waits on a dynamic import: state keeps
         * arriving while that is in flight, and without this a second battle
         * screen was mounted on top of the first — which is why the fighters
         * walked on, vanished, and walked on again.
         */
        if (state.phase === 'battle') {
          if (leaving) return;
          leaving = true;
          clock.stop();
          void import('./battle').then(({ battleScreen }) => {
            go(battleScreen(connection, isHost));
          });
          return;
        }
        if (state.phase !== 'creating' && state.phase !== 'ult') {
          clock.stop();
          return;
        }
        render(state);
      },
    });

    if (connection.state) render(connection.state);

    return () => {
      clock.stop();
      flushDrawing();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushDrawing);
      for (const fn of cleanups.splice(0)) fn();
    };
  };
}
