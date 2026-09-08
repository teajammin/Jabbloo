import { getSettings, onSettingsChange } from '../settings';

/**
 * The drifting background behind every menu screen.
 *
 * One sheet of paint carrying four radial gradients, each with a solid core
 * that fades only at its rim. Two things follow from that shape:
 *
 * Colours stay colours. Four see-through circles average where they overlap,
 * and the average of four hues is grey — which is what an earlier version was
 * quietly producing. An opaque core means an overlap takes the front colour
 * whole instead of meeting the one behind it halfway.
 *
 * And there are no edges. A gradient that reaches the transparent long before
 * the element does reads as weather rather than as four circles, which is what
 * lets it travel a long way without looking like objects sliding about.
 *
 * Each gradient wanders its own course on its own clock, and the sheet turns
 * slowly underneath them, so the field never repeats.
 */

const COLOURS = ['#9a4fb0', '#f2a25c', '#7db4ee', '#9ad9a0'];

/** Where each colour sits, at each turn of its journey. Percentages of the sheet. */
const PATHS = [
  [[8, 18], [72, 8], [86, 62], [24, 84], [8, 18]],
  [[84, 14], [26, 30], [12, 78], [70, 90], [84, 14]],
  [[18, 82], [80, 74], [92, 20], [30, 10], [18, 82]],
  [[76, 84], [14, 62], [34, 12], [88, 40], [76, 84]],
];

/**
 * One full circuit.
 *
 * Slow on purpose: the colours cross most of the screen, so they do not also
 * need to hurry. At forty seconds a glance shows a still image and a minute
 * shows a different one, which is what scenery should do.
 */
const CYCLE_SECONDS = 40;

export function mountBackdrop(): () => void {
  const root = document.createElement('div');
  root.className = 'backdrop';
  root.setAttribute('aria-hidden', 'true');

  const sheet = document.createElement('div');
  sheet.className = 'backdrop-sheet';
  // Oversized and centred, so a gradient can leave the screen entirely and
  // come back rather than piling up against an edge.
  sheet.style.backgroundImage = COLOURS.map((colour) =>
    `radial-gradient(circle at center, ${colour} 0%, ${colour} 34%, ${colour}00 68%)`).join(', ');
  sheet.style.backgroundSize = COLOURS.map((_, i) => `${58 + i * 8}% ${58 + i * 8}%`).join(', ');
  sheet.style.backgroundRepeat = 'no-repeat';
  root.appendChild(sheet);

  const animations: Animation[] = [];

  // Every gradient's position, as one animatable list — the browser
  // interpolates each layer's own coordinates within it.
  const steps = PATHS[0]!.length;
  const frames = Array.from({ length: steps }, (_, step) => ({
    backgroundPosition: PATHS.map((path) => {
      const [x, y] = path[step % path.length]!;
      return `${x}% ${y}%`;
    }).join(', '),
  }));

  animations.push(sheet.animate(frames, {
    duration: CYCLE_SECONDS * 1000,
    iterations: Infinity,
    easing: 'ease-in-out',
  }));

  // A slow turn underneath, so the four never settle into a fixed arrangement.
  animations.push(sheet.animate([
    { transform: 'rotate(0deg) scale(1.08)' },
    { transform: 'rotate(9deg) scale(1.16)' },
    { transform: 'rotate(-7deg) scale(1.1)' },
    { transform: 'rotate(0deg) scale(1.08)' },
  ], {
    duration: CYCLE_SECONDS * 3.5 * 1000,
    iterations: Infinity,
    easing: 'ease-in-out',
  }));

  document.body.prepend(root);

  /** Still colours are still pleasant; only the drifting has to stop. */
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
