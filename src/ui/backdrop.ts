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
 * The colours are the game's own candy at full strength: the ground is where
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
 * Each is a saturated field rather than a tint, large enough to own a corner
 * of the screen. That is the whole correction: the ground used to be one flat
 * dark rectangle with small accents on top of it, which is what made a game
 * built out of candy colours read as muted.
 *
 * Journeys are short on purpose. The fields drift; they do not travel. A ground
 * that moves enough to notice competes with the drawings on top of it.
 */
const LIGHTS = [
  // Gumball Fields: a violet ground with saturated gumballs pushing in from
  // the corners. Deliberately larger and far more saturated than the plum wash
  // they replace — colour owning whole regions is the point, and a dark flat
  // ground with small accents on top is exactly what read as muted.
  { colour: '#ffd84d', size: 92, from: [88, 6], to: [74, 18], seconds: 54 },   // lemon
  { colour: '#ff5c8a', size: 104, from: [4, 86], to: [18, 72], seconds: 62 },  // bubblegum
  { colour: '#3fd9c0', size: 86, from: [94, 92], to: [80, 78], seconds: 50 },  // spearmint
  { colour: '#8a5cff', size: 110, from: [40, 34], to: [54, 46], seconds: 70 }, // grape
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
      `radial-gradient(circle at center, ${colour} 0%, ${colour} 34%, ${colour}00 72%)`;
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
