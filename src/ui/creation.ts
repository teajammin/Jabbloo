import { el, button, type Screen, goHome } from './screens';
import { countdown } from './timer';
import { drawScreen } from './drawScreen';
import { battlegroundScreen } from './battleground';
import type { RoomConnection } from '../net/room';
import {
  creators, displayName, graceExpired, standIn, stepFor, stepsFor, stillWorking,
  type Player, type RoomState,
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
    let lastStep = '';
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
          showWaiting('Saved — waiting for everyone else');
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

      const send = () => {
        connection.send({ type: 'submitName', slot, name: input.value });
        showWaiting('Named — waiting for everyone else');
      };

      const form = el('form', { class: 'stack' }, input, button('Save', send, 'big primary'));
      form.addEventListener('submit', (event) => { event.preventDefault(); send(); });

      body.append(preview, ...(drawn ? [] : [
        el('p', { class: 'help-note' }, slot === 'character'
          ? 'Nothing drawn, so this one is fighting for you. Give it a name.'
          : `Nothing drawn, so you get this ${fallback.name}. Name it anyway.`),
      ]), form);
      input.focus();
    }

    function showWaiting(message: string): void {
      // Tear down whatever was showing first. Replacing the DOM alone leaves
      // the drawing tool's window listener bound and its menu in document.body
      // — once per drawing step, so four by the end of the flow.
      for (const fn of cleanups.splice(0)) fn();
      body.replaceChildren(
        el('p', { class: 'lede waiting' }, message),
        roster,
      );
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

      const step = stepFor(state, me.id);

      // Finished, and waiting on the others — the only place anyone waits now.
      if (!step || me.progress.done) {
        heading.textContent = 'All done';
        const others = stillWorking(state).filter((p) => p.id !== me.id);
        subheading.textContent = others.length === 0
          ? 'Everyone is ready.'
          : others.length === 1
            ? `Waiting for ${others[0]!.name}.`
            : `Waiting for ${others.length} others.`;
        clock.setDeadline(longestRemaining(state), 0);

        const key = `${state.phase}:${state.ultRound}:waiting`;
        if (key === lastStep) return;
        lastStep = key;
        flushDrawing();
        for (const fn of cleanups.splice(0)) fn();
        showWaitingRoom();
        return;
      }

      heading.textContent = step.prompt;
      subheading.textContent = ult
        ? 'The scores are level. One more weapon — your Ultimate — decides it.'
        : `Step ${me.progress.step + 1} of ${stepsFor(state).length}`;
      clock.setDeadline(me.progress.endsAt, step.seconds);

      // Only rebuild when this player's own step changes, so a stroke in
      // progress survives somebody else finishing theirs.
      const key = `${state.phase}:${state.ultRound}:${me.progress.step}`;
      if (key === lastStep) return;
      lastStep = key;

      // Their step is over: send whatever is on the canvas before the tool
      // that holds it is torn down.
      flushDrawing();
      for (const fn of cleanups.splice(0)) fn();

      if (step.kind === 'draw') showDraw(step.slot, step.prompt);
      else showName(step.slot);
    }

    /** The latest anyone is still working until. */
    function longestRemaining(state: RoomState): number {
      const ends = stillWorking(state).map((p) => p.progress.endsAt);
      return ends.length > 0 ? Math.max(...ends) : 0;
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
        if (state.phase === 'battleground') {
          clock.stop();
          go(battlegroundScreen(connection, isHost));
          return;
        }
        // An ULT runs straight into the fight on the ground already chosen.
        if (state.phase === 'battle') {
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
