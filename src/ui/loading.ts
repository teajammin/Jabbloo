import { bubbleText } from './bubbleText';

/**
 * "Loading", in the corner, while the game is genuinely busy.
 *
 * Only for real waits — the arena is the one in this game: a renderer is
 * imported, fifty-seven effect sprites, thirty letters, a photograph and
 * everyone's artwork are fetched and decoded, and until that finishes there is
 * nothing to show but an empty stage. A room watching a big screen should
 * never have to guess whether something is happening.
 *
 * Deliberately a corner badge rather than a screen over everything: whatever
 * is behind it — the battleground painting in, the first fighter arriving — is
 * more interesting than a spinner, and covering it up would trade information
 * for decoration. It is never the right answer to a screen that is *wrong*,
 * only to one that is not ready.
 */
export function loadingBadge(): { root: HTMLElement; done: () => void } {
  const root = document.createElement('div');
  root.className = 'loading-badge';
  root.setAttribute('role', 'status');

  /*
   * Sized against the screen it is on, not in fixed pixels.
   *
   * Thirty-four pixels of lettering is a modest badge on a laptop and a
   * cramped one on a phone, where the same word has a third of the width to
   * sit in. Taking it from the narrower side keeps the badge the same fraction
   * of whatever it is shown on, and the bounds stop it becoming either a
   * postage stamp or a banner.
   */
  const room = typeof window === 'undefined'
    ? 34
    : Math.min(window.innerWidth, window.innerHeight);
  const height = Math.max(20, Math.min(34, Math.round(room * 0.062)));

  root.appendChild(bubbleText('LOADING', { height, wave: true }));

  let gone = false;
  const done = (): void => {
    if (gone) return;
    gone = true;
    // Faded rather than cut, so a fast load does not read as a flicker.
    root.classList.add('is-done');
    setTimeout(() => root.remove(), 260);
  };

  return { root, done };
}
