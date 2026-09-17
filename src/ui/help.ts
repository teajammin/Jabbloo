import { el } from './screens';
import {
  MAX_PLAYERS, MAX_PROMPT_WORDS, MAX_SCORE, ROUNDS_EACH, STARTING_HEALTH, WEAPON_COUNT,
} from '../shared/protocol';

/**
 * The how-to-play panel, reachable from the "?" on every screen.
 *
 * A <dialog> rather than a hand-rolled overlay: it gets focus trapping,
 * Escape-to-close and inertness of the page behind it from the browser.
 */
export function helpDialog(): HTMLDialogElement {
  const dialog = el('dialog', { class: 'help' });

  const close = el('button', { class: 'help-close', type: 'button' }, '×');
  close.setAttribute('aria-label', 'Close help');
  close.addEventListener('click', () => dialog.close());


  dialog.append(
    close,
    el('h2', {}, 'How to play'),
    el('ol', { class: 'help-steps' },
      el('li', {}, `Draw a character, then ${WEAPON_COUNT} weapons, on your own phone. `
        + 'Name each one as you finish it — anything you leave blank gets a stand-in.'),
      el('li', {}, 'Everyone votes on a battleground. One is drawn from the votes, '
        + 'so a pick is a ticket rather than a majority.'),
      el('li', {}, `On your turn, pick a weapon and describe how you use it — up to ${
        MAX_PROMPT_WORDS} words. There are examples under the box if you go blank.`),
      el('li', {}, 'The big screen animates what you wrote and reads it out '
        + 'while it plays. Nonsense is fine; it is the point.'),
      el('li', {}, `Each move is scored out of ${MAX_SCORE}, and that is the damage `
        + `it does. Everyone starts on ${STARTING_HEALTH} health.`),
      el('li', {}, `${ROUNDS_EACH} rounds each. Least damage taken wins. A tie means `
        + 'one more weapon each — an Ultimate — and another round.'),
    ),
    el('p', { class: 'help-note' },
      'Aim weapons to the right when you draw them, at the enemy. '
      + 'Where you hit matters: a heart is worth more than a knee, and anything '
      + 'that keeps hurting afterwards — poison, fire, a curse — is worth more '
      + 'than the same idea landed once.'),
    el('p', { class: 'help-note' },
      '2 players: an AI judges. 3 or 5: the players not fighting judge. '
      + `4 or 6: tag team. ${MAX_PLAYERS} players max, one big screen plus their phones.`),
  );

  return dialog;
}

/** The floating "?" button that opens it. */
export function helpButton(dialog: HTMLDialogElement): HTMLButtonElement {
  const node = el('button', { class: 'help-open', type: 'button' }, '?');
  node.setAttribute('aria-label', 'How to play');
  node.addEventListener('click', () => dialog.showModal());
  return node;
}
