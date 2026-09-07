import type { Texture } from 'pixi.js';
import type { HandAnchor } from './types';

/**
 * Finding the limbs a player already drew.
 *
 * The rig draws its own capsule arm and leg for melee moves, which is right
 * for a bean with no limbs and wrong for a character drawn with two arms and
 * two legs — there, the procedural limb reads as a mis-rig rather than an
 * animation. So the silhouette is scanned first: where the drawing has its
 * own limbs, the rig keeps its hands off and simply puts the weapon in the
 * hand the player drew.
 *
 * Deliberately a silhouette analysis rather than a vision-model call. It is
 * free, instant, offline, and — for the crayon-thick shapes this game
 * produces — about as reliable: a limb is a narrow thing sticking out of a
 * wide thing, which is a measurement, not a judgement.
 *
 * The maths works on a plain alpha mask so it can be tested without a canvas.
 */

/** A 1-bit silhouette: one byte per pixel, 1 where the drawing is opaque. */
export interface Silhouette {
  width: number;
  height: number;
  alpha: Uint8Array;
}

export interface DetectedLimbs {
  /** True when the drawing has arms of its own. */
  arms: boolean;
  /** True when it has legs. */
  legs: boolean;
  /**
   * Where to hang the weapon, in the fractional anchor coordinates the rig
   * uses. Null when no arm was found and the default anchor should stand.
   */
  hand: HandAnchor | null;
}

/** Sampling resolution. Enough to see a limb, small enough to scan instantly. */
const SAMPLE = 96;
/** Below this, a pixel is background rather than drawing. */
const OPAQUE = 96;

const NOTHING: DetectedLimbs = { arms: false, legs: false, hand: null };

/**
 * Reduces a texture to a silhouette.
 *
 * Downsampled hard: limb detection wants the shape, and at 96px a stray
 * anti-aliased pixel or a gap in a hand-drawn outline stops mattering.
 */
export function silhouetteOf(texture: Texture): Silhouette | null {
  const source = (texture.baseTexture.resource as { source?: CanvasImageSource })?.source;
  if (!source) return null;

  try {
    const ratio = texture.height > 0 ? texture.width / texture.height : 1;
    const width = Math.max(8, Math.round(SAMPLE * Math.min(1, ratio)));
    const height = Math.max(8, Math.round(SAMPLE * Math.min(1, 1 / ratio)));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(source, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);

    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]! >= OPAQUE ? 1 : 0;
    return { width, height, alpha };
  } catch {
    // A tainted canvas throws. Procedural limbs are the safe answer.
    return null;
  }
}

/** The opaque spans on one row, as [start, end] pixel pairs. */
function runs(mask: Silhouette, y: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let x = 0; x < mask.width; x++) {
    const on = mask.alpha[y * mask.width + x] === 1;
    if (on && start < 0) start = x;
    if (!on && start >= 0) { out.push([start, x - 1]); start = -1; }
  }
  if (start >= 0) out.push([start, mask.width - 1]);
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Reads arms, legs and a hand position out of a silhouette.
 *
 * Legs are two separated runs near the bottom — a bean has one run all the way
 * down, a character with legs has two with daylight between them.
 *
 * Arms are rows in the middle that are markedly wider than the body's usual
 * width. The far end of the widest such row is where the hand is, which is
 * exactly where a weapon should go.
 */
export function detectLimbs(mask: Silhouette | null): DetectedLimbs {
  if (!mask || mask.width < 8 || mask.height < 8) return NOTHING;

  // Bounds of the drawing itself; padding in the PNG must not skew the ratios.
  let top = -1, bottom = -1, left = mask.width, right = -1;
  const rowWidth: number[] = new Array(mask.height).fill(0);
  for (let y = 0; y < mask.height; y++) {
    let count = 0;
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x] !== 1) continue;
      count++;
      if (x < left) left = x;
      if (x > right) right = x;
    }
    rowWidth[y] = count;
    if (count > 0) {
      if (top < 0) top = y;
      bottom = y;
    }
  }

  const height = bottom - top + 1;
  const width = right - left + 1;
  if (top < 0 || height < 8 || width < 4) return NOTHING;

  // --- legs: two runs, separated, near the bottom ---------------------------

  const legTop = top + Math.round(height * 0.72);
  let splitRows = 0;
  let legRows = 0;
  const gapNeeded = Math.max(1, Math.round(width * 0.06));
  for (let y = legTop; y <= bottom; y++) {
    const spans = runs(mask, y);
    if (spans.length === 0) continue;
    legRows++;
    const gaps = spans.slice(1).some((span, i) => span[0] - spans[i]![1] > gapNeeded);
    if (spans.length >= 2 && gaps) splitRows++;
  }
  // A majority rather than any single row: one gap can be a drawn-in shadow,
  // a run of them down the bottom of the figure is a pair of legs.
  const legs = legRows > 0 && splitRows / legRows > 0.5;

  // --- arms: rows markedly wider than the body ------------------------------

  const bandTop = top + Math.round(height * 0.22);
  const bandBottom = top + Math.round(height * 0.72);
  const widths = rowWidth.slice(bandTop, bandBottom + 1).filter((w) => w > 0);
  const body = median(widths);

  let armY = -1;
  let armWidth = 0;
  for (let y = bandTop; y <= bandBottom; y++) {
    if (rowWidth[y]! > armWidth) { armWidth = rowWidth[y]!; armY = y; }
  }
  // Half again as wide as the body is the line between "this row happens to be
  // the widest" and "there is something sticking out here". Drawn shoulders,
  // hair and capes all widen a figure by less than that; an arm clears it
  // easily, since an arm is about as long as a torso is wide.
  const arms = body > 0 && armWidth >= body * 1.5 && armY >= 0;
  if (!arms) return { arms: false, legs, hand: null };

  // The hand is the far end of the widest run on that row, on whichever side
  // reaches further from the body's own centre line.
  const spans = runs(mask, armY);
  const centre = (left + right) / 2;
  let handX = centre;
  let reach = 0;
  for (const [start, end] of spans) {
    for (const x of [start, end]) {
      const distance = Math.abs(x - centre);
      if (distance > reach) { reach = distance; handX = x; }
    }
  }

  // Pulled a little back along the arm so the grip sits in the hand rather
  // than off the fingertips.
  handX += handX > centre ? -width * 0.03 : width * 0.03;

  return {
    arms,
    legs,
    // Fractional, measured from the sprite's centre — the rig's own units, so
    // this survives whatever resolution the drawing arrived at.
    hand: {
      x: (2 * handX) / mask.width - 1,
      y: (2 * armY) / mask.height - 1,
    },
  };
}
