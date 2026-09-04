import { el } from './screens';
import { reparentCursor } from './cursor';

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

  // The modal sits in the top layer, so the cursor has to come with it.
  dialog.addEventListener('close', () => reparentCursor(null));

  dialog.append(
    close,
    el('h2', {}, 'How to play'),
    el('ol', { class: 'help-steps' },
      el('li', {}, 'Draw a character, then three weapons. Name them all.'),
      el('li', {}, 'Vote on a battleground.'),
      el('li', {}, 'On your turn, pick a weapon and describe how you use it — up to 50 words.'),
      el('li', {}, 'An AI animates your description. Nonsense still gets you a swing.'),
      el('li', {}, 'A judge scores each move out of 33. Everyone starts on 100 health.'),
      el('li', {}, 'Best of three rounds. Least damage taken wins. A tie means one more weapon, as an ULT.'),
    ),
    el('p', { class: 'help-note' },
      '2 players: an AI judges. 3 or 5: the players not fighting judge. 4 or 6: tag team. Six players max.'),
  );

  return dialog;
}

/** The floating "?" button that opens it. */
export function helpButton(dialog: HTMLDialogElement): HTMLButtonElement {
  const node = el('button', { class: 'help-open', type: 'button' }, '?');
  node.setAttribute('aria-label', 'How to play');
  node.addEventListener('click', () => {
    dialog.showModal();
    reparentCursor(dialog);
  });
  return node;
}
