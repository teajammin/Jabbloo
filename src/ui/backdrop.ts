import { getSettings, onSettingsChange } from '../settings';

/**
 * The background behind every menu screen: slow lights over grain.
 *
 * A handful of deep glows on the paper, each shifting a little way and coming
 * back. Not a pan: a sliding gradient has to tile to cover the screen, and a
 * tile boundary at an angle travels across as a visible line — which is what
 * the moving line was. A radial glow that fades to nothing has no boundary to
 * show, so there is nothing to see but the colour moving.
 *
 * Over them, a fixed film of noise, which is what stops a large area of flat
 * dark looking like an empty div.
 *
 * The colours are deep versions of the game's own: the ink the page is drawn
 * on, warmed toward plum on one side and cooled toward indigo and teal on the
 * other. They are meant to be noticed only if you look for them — the accents
 * and the players' drawings are what should carry colour.
 *
 * The battle stage and the drawing screen opt out. Both cover the window with
 * their own thing, and a background nobody can see still costs every frame.
 */

/**
 * The lights: a colour, how big it is, and the small journey it makes.
 *
 * Each is only a few shades off the paper it sits on. On a dark ground a
 * little colour goes a long way, and these are meant to be felt rather than
 * looked at — the accents and the players' drawings carry the colour.
 *
 * Journeys are short on purpose. The colours move around a little; they do not
 * travel.
 */
const LIGHTS = [
  { colour: '#4a3568', size: 78, from: [22, 28], to: [34, 40], seconds: 46 },  // plum
  { colour: '#2f3a6b', size: 86, from: [74, 22], to: [62, 34], seconds: 58 },  // indigo
  { colour: '#26505c', size: 72, from: [28, 76], to: [40, 64], seconds: 52 },  // teal
  { colour: '#4a2f52', size: 64, from: [78, 74], to: [66, 62], seconds: 64 },  // mauve
];

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

  /*
   * One element per light rather than one element with four background layers.
   *
   * Layers share a single background-position, so four animations of it on one
   * element overwrite each other and only the last would move. Separate
   * elements each animate their own transform, which is also the cheaper
   * property — it never asks the page to repaint.
   */
  const lights = LIGHTS.map(({ colour, size, from }) => {
    const light = document.createElement('div');
    light.className = 'backdrop-light';
    light.style.background =
      `radial-gradient(circle at center, ${colour} 0%, ${colour} 30%, ${colour}00 70%)`;
    light.style.width = `${size}%`;
    light.style.left = `${from[0]}%`;
    light.style.top = `${from[1]}%`;
    return light;
  });

  const grain = document.createElement('div');
  grain.className = 'backdrop-grain';
  grain.style.backgroundImage = `url("data:image/svg+xml,${GRAIN}")`;

  root.append(...lights, grain);
  document.body.prepend(root);

  // Each light takes its own time over its own short path, so the four never
  // fall into step and the field never repeats.
  const animations = lights.map((light, i) => {
    const { from, to, seconds } = LIGHTS[i]!;
    return light.animate(
      [
        { transform: 'translate(-50%, -50%)' },
        { transform: `translate(calc(-50% + ${to[0]! - from[0]!}%), calc(-50% + ${to[1]! - from[1]!}%))` },
      ],
      {
        duration: seconds * 1000,
        iterations: Infinity,
        direction: 'alternate',
        easing: 'ease-in-out',
      },
    );
  });

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
