import { getSettings, onSettingsChange } from '../settings';

/**
 * The drifting background behind every menu screen.
 *
 * One wide gradient, slid slowly sideways. Nothing moves independently and
 * nothing overlaps: the colours simply arrive and leave, which is the calmest
 * motion available and the cheapest — a single background-position on a single
 * element, and no blur at all.
 *
 * The palette is the one that was chosen from the photographs, taken from the
 * images themselves rather than approximated: the warm creams, pinks and
 * purples are P4's own colours, the blues are P1's, and two greens bridge them
 * so the run from cool to warm has something in the middle.
 *
 * The battle stage and the drawing screen opt out — both cover the window with
 * their own thing, and a background nobody can see still costs every frame.
 */

/**
 * The run of colour, left to right, doubled so the loop is seamless.
 *
 * Proportions are set by how much of the run each colour occupies, which is
 * why the stops are written as they are: blues about a third, greens a sixth,
 * and the rest P4's warm end.
 */
const RUN = [
  '#cb6ac8',  // P4 · orchid
  '#e790ae',  // P4 · rose
  '#f2eebb',  // P4 · pale butter
  '#a8dfae',  // green · leaf
  '#6fc8b4',  // green · sea
  '#8fd9ea',  // P1 · pale teal
  '#7cc3ee',  // P1 · sky
  '#9fb6ef',  // P1 · periwinkle, back toward the purple
  '#c38ec0',  // P4 · mauve, closing the circle
];

/** One pass of the whole run. Slow enough to be scenery. */
const CYCLE_SECONDS = 70;

export function mountBackdrop(): () => void {
  const root = document.createElement('div');
  root.className = 'backdrop';
  root.setAttribute('aria-hidden', 'true');

  const sheet = document.createElement('div');
  sheet.className = 'backdrop-sheet';

  // Written out twice so the end meets the beginning: sliding exactly one
  // copy's width returns to where it started, with no seam to hide.
  const stops = [...RUN, ...RUN, RUN[0]!].join(', ');
  sheet.style.backgroundImage = `linear-gradient(100deg, ${stops})`;

  root.appendChild(sheet);
  document.body.prepend(root);

  const animations = [sheet.animate(
    [{ backgroundPosition: '0% 50%' }, { backgroundPosition: '-100% 50%' }],
    { duration: CYCLE_SECONDS * 1000, iterations: Infinity, easing: 'linear' },
  )];

  /** Still colours are still pleasant; only the shifting has to stop. */
  function apply(): void {
    const still = getSettings().reduceMotion;
    for (const animation of animations) {
      if (still) animation.pause();
      else animation.play();
    }
  }

  apply();
  const stopWatching = onSettingsChange(apply);

  return () => {
    stopWatching();
    for (const animation of animations) animation.cancel();
    root.remove();
  };
}
