import { el, button, type Screen, goHome } from './screens';
import { countdown } from './timer';
import type { RoomConnection } from '../net/room';
import {
  MAX_PROMPT_WORDS, MOVE_SECONDS, wordCount, type RoomState,
} from '../shared/protocol';

/**
 * The move screen, on a fighter's phone.
 *
 * The brief's shape: pick a weapon, then finish the sentence
 * "<character> will use the <weapon> by …" in up to fifty words. Naming the
 * weapon in the sentence is what makes the limit feel like a prompt rather
 * than a form field.
 */
export function moveScreen(
  connection: RoomConnection,
  weapons: { name: string }[],
  characterName: string,
): Screen {
  return (root, go) => {
    let weapon = 0;
    let left = false;
    let submitted = false;

    const clock = countdown();
    const heading = el('h1', { class: 'creation-title' }, 'Your turn');
    const sentence = el('p', { class: 'move-sentence' });
    const status = el('p', { class: 'lede' }, '');

    const weaponRow = el('div', { class: 'tool-row weapon-row' });
    const weaponButtons: HTMLButtonElement[] = [];

    const prompt = el('textarea', {
      class: 'move-prompt', rows: 4,
      placeholder: 'swinging it overhead and slamming it down like a thunderbolt',
    });
    prompt.setAttribute('maxlength', '400');

    const counter = el('span', { class: 'move-count' }, `0 / ${MAX_PROMPT_WORDS}`);
    const send = button('Attack', () => submit(), 'big primary');

    function describe(): void {
      const name = weapons[weapon]?.name ?? 'their weapon';
      sentence.textContent = `${characterName} will use the ${name} by…`;
    }

    function updateCount(): void {
      const words = wordCount(prompt.value);
      counter.textContent = `${words} / ${MAX_PROMPT_WORDS}`;
      // Over the limit is a warning, not a block: the server trims, and
      // stopping mid-word as someone types is worse than letting them finish.
      counter.classList.toggle('is-over', words > MAX_PROMPT_WORDS);
    }

    function pick(index: number): void {
      weapon = index;
      for (const [i, node] of weaponButtons.entries()) {
        node.setAttribute('aria-pressed', String(i === index));
      }
      describe();
    }

    function submit(): void {
      if (submitted) return;
      submitted = true;
      connection.send({ type: 'submitMove', weapon, prompt: prompt.value });
      status.textContent = 'Sent — watch the big screen.';
      send.disabled = true;
      prompt.disabled = true;
      for (const node of weaponButtons) node.disabled = true;
    }

    /**
     * Each weapon as its own drawing, not just its name.
     *
     * A player has three weapons and fifty words to describe using one of
     * them; picking from a row of names means remembering which was which,
     * when they drew all three ten minutes ago.
     */
    const previews: HTMLImageElement[] = [];
    weapons.forEach((w, index) => {
      const preview = el('img', { class: 'weapon-preview', alt: '' });
      preview.hidden = true;
      previews.push(preview);

      const node = el('button', { class: 'weapon-pick', type: 'button' },
        preview,
        el('span', { class: 'weapon-name' }, w.name),
      );
      node.setAttribute('aria-pressed', String(index === 0));
      node.addEventListener('click', () => pick(index));
      weaponButtons.push(node);
      weaponRow.appendChild(node);
    });

    // The artwork is on the server; a phone asks for its own and nobody
    // else's. Names are already on screen, so the pictures fill in when they
    // arrive rather than holding the screen up.
    connection.on({
      onArt: (art) => {
        const mine = art.find((entry) => entry.playerId === connection.playerId);
        if (!mine) return;
        for (const [index, preview] of previews.entries()) {
          const png = mine.weapons[index]?.png;
          if (!png) continue;
          preview.src = png;
          preview.hidden = false;
        }
      },
    });
    connection.send({ type: 'requestArt' });

    prompt.addEventListener('input', updateCount);
    describe();
    updateCount();

    root.append(
      el('main', { class: 'screen screen-move' },
        heading, clock.root, weaponRow, sentence,
        prompt,
        el('div', { class: 'tool-row' }, counter),
        send, status,
      ),
    );

    /**
     * Hands the phone back to the battle screen once the move is out of the
     * player's hands.
     *
     * All the phase routing — the next turn, an ULT, the results — lives
     * there, so leaving a phone parked on this screen would strand it for the
     * rest of the game.
     */
    function leave(): void {
      if (left) return;
      left = true;
      clock.stop();
      void import('./battle').then(({ battleScreen }) => {
        go(battleScreen(connection, false));
      });
    }

    connection.on({
      onClosed: () => goHome(go),
      onState: (state: RoomState) => {
        if (left) return;
        const turn = state.turn;
        if (!turn || state.phase !== 'battle') { leave(); return; }

        if (turn.phase === 'picking') {
          clock.setDeadline(state.stepEndsAt, MOVE_SECONDS);
          return;
        }

        clock.setDeadline(0, 1);
        // Time ran out or the other player finished; either way it is gone.
        if (!submitted) {
          submitted = true;
          send.disabled = true;
          prompt.disabled = true;
          status.textContent = 'Time — the AI will improvise.';
        }
        leave();
      },
    });

    if (connection.state) {
      clock.setDeadline(connection.state.stepEndsAt, MOVE_SECONDS);
    }

    return () => clock.stop();
  };
}
