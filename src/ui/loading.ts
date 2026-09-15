/**
 * "Loading", in the corner, while the game is genuinely busy.
 *
 * Only for real waits — the arena is the one in this game: a renderer is
 * imported, fifty-seven effect sprites, thirty letters, a photograph and
 * everyone's artwork are fetched and decoded, and until that finishes there is
 * nothing to show but an empty stage. A room watching a big screen should
 * never have to guess whether something is happening.
 *
 * Set in the interface font rather than the game's bubble letters, which was a
 * mistake worth explaining: those letters are thirty-odd separate image files,
 * so the badge announcing that the network was busy could not appear until the
 * network had fetched seven more things. It arrived late, a letter at a time,
 * during precisely the wait it existed to cover. Text draws in the frame it is
 * added, which is the entire job.
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
  root.setAttribute('aria-label', 'Loading');

  // One span per letter, so the hop can run through them in order. Marked
  // hidden from a screen reader, which has the label above instead.
  const word = document.createElement('span');
  word.className = 'loading-word';
  word.setAttribute('aria-hidden', 'true');
  [...'LOADING'].forEach((letter, index) => {
    const span = document.createElement('span');
    span.textContent = letter;
    // The same hop, a beat after the one before it: what makes it a wave
    // rather than a crowd is that every letter does the same thing in turn.
    span.style.animationDelay = `${(index * 0.075).toFixed(3)}s`;
    word.appendChild(span);
  });
  root.appendChild(word);

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
