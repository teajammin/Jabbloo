import { el, button, type Screen } from './screens';
import { countdown } from './timer';
import { drawScreen } from './drawScreen';
import { battlegroundScreen } from './battleground';
import type { RoomConnection } from '../net/room';
import {
  CREATION_STEPS, creators, currentStep, type RoomState,
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
    let lastStep = -1;
    let drawnPng: string | null = null;

    const clock = countdown();
    const heading = el('h1', { class: 'creation-title' }, '');
    const subheading = el('p', { class: 'lede' }, '');
    const body = el('div', { class: 'creation-body' });
    const roster = el('ul', { class: 'roster' });

    /** Submits whatever the current step produced, then waits for the others. */
    const submitDrawing = (png: string, slot: string) => {
      drawnPng = png;
      connection.send({ type: 'submitDrawing', slot, png });
    };

    // --- the drawing step ---------------------------------------------------

    function showDraw(slot: string, prompt: string): void {
      body.replaceChildren();
      const holder = el('div', { class: 'creation-canvas' });
      body.appendChild(holder);

      // drawScreen is a Screen, so it mounts into a host element of its own.
      const teardown = drawScreen({
        title: prompt,
        embedded: true,
        onDone: (png) => {
          submitDrawing(png, slot);
          showWaiting('Saved — waiting for everyone else');
        },
      })(holder, go);

      cleanups.push(() => { teardown?.(); });
    }

    // --- the naming step ----------------------------------------------------

    function showName(slot: string): void {
      body.replaceChildren();

      const preview = drawnPng
        ? el('img', { class: 'creation-preview', src: drawnPng, alt: '' })
        : el('div', { class: 'creation-preview empty' });

      const input = el('input', {
        type: 'text', class: 'name-input', maxLength: 24,
        placeholder: slot === 'character' ? 'Sir Bonkalot' : 'Butter Sword',
      });
      input.setAttribute('autocomplete', 'off');

      const send = () => {
        connection.send({ type: 'submitName', slot, name: input.value });
        showWaiting('Named — waiting for everyone else');
      };

      const form = el('form', { class: 'stack' }, input, button('Save', send, 'big primary'));
      form.addEventListener('submit', (event) => { event.preventDefault(); send(); });

      body.append(preview, form);
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

    function renderRoster(state: RoomState): void {
      roster.replaceChildren();
      for (const player of creators(state)) {
        const row = el('li', { class: `player${player.progress.ready ? ' is-ready' : ''}` },
          el('span', { class: 'avatar placeholder' }, player.name.slice(0, 1).toUpperCase()),
          el('span', { class: 'player-name' }, player.name),
          el('span', { class: 'you' }, player.progress.ready ? 'done' : 'working'),
        );
        roster.appendChild(row);
      }
    }

    function render(state: RoomState): void {
      renderRoster(state);

      const step = currentStep(state);
      if (!step) return;

      heading.textContent = step.prompt;
      subheading.textContent = isHost
        ? 'Everyone is drawing on their phones.'
        : `Step ${state.step + 1} of ${CREATION_STEPS.length}`;
      clock.setDeadline(state.stepEndsAt, step.seconds);

      // Only rebuild when the step actually changes, so typing a name or a
      // stroke in progress survives other players' updates arriving.
      if (state.step === lastStep) return;
      lastStep = state.step;

      for (const fn of cleanups.splice(0)) fn();

      const me = state.players.find((p) => p.id === connection.playerId);
      if (isHost) { showHost(); return; }
      if (!me || me.role === 'judge' || me.role === 'unassigned') { showJudge(); return; }

      if (step.kind === 'draw') showDraw(step.slot, step.prompt);
      else showName(step.slot);
    }

    root.append(
      el('main', { class: 'screen screen-creation' }, heading, subheading, clock.root, body),
    );

    connection.on({
      onState: (state) => {
        if (state.phase === 'battleground') {
          clock.stop();
          go(battlegroundScreen(connection, isHost));
          return;
        }
        if (state.phase !== 'creating') {
          clock.stop();
          return;
        }
        render(state);
      },
    });

    if (connection.state) render(connection.state);

    return () => {
      clock.stop();
      for (const fn of cleanups.splice(0)) fn();
    };
  };
}
