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

/**
 * The colours and how much of the field each one should hold.
 *
 * Green a third, blue a third, purple and coral-orange a fifth each. The green
 * is still two greens — a fresh leaf and a deeper sea, which is what stopped
 * it looking like one flat colour — but they now share that third between
 * them rather than taking one each.
 *
 * Shares are written as shares because that is the decision; the gradient
 * sizes below are worked out from them. Area grows with the square of the
 * width, so a colour asked for twice the presence needs about 1.4 times the
 * size, which is not a number anyone should have to keep in their head.
 */
const COLOURS = [
  { colour: '#9a4fb0', share: 0.20 },   // purple
  { colour: '#f28a63', share: 0.20 },   // coral orange
  { colour: '#8ed9a6', share: 0.15 },   // fresh green
  { colour: '#4fb086', share: 0.15 },   // deeper, sea-leaning green
  { colour: '#7db4ee', share: 0.30 },   // blue
];

/** The widest a gradient gets, as a percentage of the sheet. */
const MAX_SIZE = 82;

/** Share of the field to gradient width. Painted largest-last, so the big ones
 *  do not sit on top of the small ones and swallow them. */
const LAYERS = [...COLOURS]
  .map(({ colour, share }) => ({
    colour,
    size: MAX_SIZE * Math.sqrt(share / Math.max(...COLOURS.map((c) => c.share))),
  }))
  .sort((a, b) => a.size - b.size);

/** Where each colour sits, at each turn of its journey. Percentages of the sheet. */
const PATHS = [
  [[8, 18], [72, 8], [86, 62], [24, 84], [8, 18]],
  [[84, 14], [26, 30], [12, 78], [70, 90], [84, 14]],
  [[18, 82], [80, 74], [92, 20], [30, 10], [18, 82]],
  [[76, 84], [14, 62], [34, 12], [88, 40], [76, 84]],
  [[46, 46], [8, 70], [64, 30], [92, 82], [46, 46]],
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
  sheet.style.backgroundImage = LAYERS.map(({ colour }) =>
    `radial-gradient(circle at center, ${colour} 0%, ${colour} 34%, ${colour}00 68%)`).join(', ');
  sheet.style.backgroundSize = LAYERS.map(({ size }) =>
    `${size.toFixed(1)}% ${size.toFixed(1)}%`).join(', ');
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
