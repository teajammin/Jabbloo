import { getSettings, onSettingsChange } from '../settings';

/**
 * The background behind every menu screen: a slow wash of colour over grain.
 *
 * Two layers. Underneath, one wide gradient sliding sideways — nothing moves
 * independently and nothing overlaps, so nothing can average into grey, and
 * the run is written out twice so the loop has no seam. Over it, a fixed film
 * of noise, which is what stops a large area of flat dark looking like an
 * empty div.
 *
 * The colours are deep versions of the game's own: the ink the page is drawn
 * on, warmed toward plum on one side and cooled toward indigo and teal on the
 * other. They are meant to be noticed only if you look for them — the accents
 * and the players' drawings are what should carry colour.
 *
 * The battle stage and the drawing screen opt out. Both cover the window with
 * their own thing, and a background nobody can see still costs every frame.
 */

/** The run of colour, left to right. Deep, and close enough to blend. */
const RUN = [
  '#241f33',  // ink, warmed
  '#2f2440',  // plum
  '#272b4a',  // indigo
  '#22354a',  // slate blue
  '#1f3a3f',  // deep teal
  '#26283f',  // back toward indigo
];

/** One pass of the whole run. Slow enough to be scenery. */
const CYCLE_SECONDS = 90;

/**
 * Film grain, as a data URI.
 *
 * Generated rather than downloaded: it is a hundred and fifty bytes of SVG
 * against a texture file's tens of kilobytes, it tiles perfectly, and it
 * scales with the screen instead of being resampled on a phone.
 */
const GRAIN = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140">
     <filter id="n">
       <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>
       <feColorMatrix type="saturate" values="0"/>
     </filter>
     <rect width="140" height="140" filter="url(#n)" opacity="0.55"/>
   </svg>`.replace(/\s+/g, ' '),
);

export function mountBackdrop(): () => void {
  const root = document.createElement('div');
  root.className = 'backdrop';
  root.setAttribute('aria-hidden', 'true');

  const sheet = document.createElement('div');
  sheet.className = 'backdrop-sheet';
  // Written out twice so the end meets the beginning: sliding exactly one
  // copy's width returns to where it started, with nothing to hide.
  sheet.style.backgroundImage =
    `linear-gradient(100deg, ${[...RUN, ...RUN, RUN[0]!].join(', ')})`;

  const grain = document.createElement('div');
  grain.className = 'backdrop-grain';
  grain.style.backgroundImage = `url("data:image/svg+xml,${GRAIN}")`;

  root.append(sheet, grain);
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
