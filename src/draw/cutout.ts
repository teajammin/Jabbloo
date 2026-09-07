/**
 * Background removal, in pixels.
 *
 * Kept as a pure function over a pixel buffer — no canvas, no DOM — so the
 * hard part can be tested against images built by hand rather than judged by
 * eye on a phone.
 *
 * The approach is a flood inward from the border. That matters more than any
 * refinement: a global colour key punches holes through a subject wherever it
 * happens to share a colour with the wall behind it, while a flood can only
 * ever eat what the background is actually connected to.
 *
 * Three things make it hold up on a real photograph:
 *
 *   - The background is described by several colours, not one. A wall lit from
 *     one side is two colours; a floor meeting a wall is two more. One average
 *     of the corners sits between them and matches neither.
 *   - The tolerance comes from the picture. How much a background varies is a
 *     property of that photograph, and a fixed number is either too tight for
 *     a gradient or loose enough to eat a face.
 *   - The edge is feathered. A hard threshold leaves a jagged rim of
 *     background-coloured pixels, which is the thing that makes a cutout look
 *     cut out.
 */

export interface CutoutOptions {
  /** Multiplies the tolerance worked out from the border. Higher cuts more. */
  strength?: number;
  /** Ignore transparent pixels; they are already gone. */
  alphaFloor?: number;
}

type Colour = [number, number, number];

/**
 * Perceptual-ish distance between two colours.
 *
 * Plain Euclidean RGB treats a change in blue as equal to the same change in
 * green, which the eye does not. This is the "redmean" weighting: cheap, and
 * far closer to what a person would call a similar colour.
 */
export function colourDistance(a: Colour, b: Colour): number {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(
    (((512 + rmean) * dr * dr) / 256) + 4 * dg * dg + (((767 - rmean) * db * db) / 256),
  );
}

/** The colours around the outside of the picture, where the background is. */
function borderSamples(data: Uint8ClampedArray, w: number, h: number): Colour[] {
  const out: Colour[] = [];
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.02));
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3]! < 8) return;
    out.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  };
  for (let x = 0; x < w; x++) {
    for (let d = 0; d < band; d++) { push(x, d); push(x, h - 1 - d); }
  }
  for (let y = 0; y < h; y++) {
    for (let d = 0; d < band; d++) { push(d, y); push(w - 1 - d, y); }
  }
  return out;
}

/**
 * Groups the border colours into a handful of representatives.
 *
 * Greedy rather than k-means: with a threshold this coarse the two agree, and
 * this runs in one pass over a few thousand samples on a phone.
 */
export function clusterColours(samples: Colour[], threshold = 60, max = 4): Colour[] {
  const centres: { sum: Colour; count: number }[] = [];

  for (const sample of samples) {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < centres.length; i++) {
      const centre = centres[i]!;
      const mean: Colour = [
        centre.sum[0] / centre.count,
        centre.sum[1] / centre.count,
        centre.sum[2] / centre.count,
      ];
      const distance = colourDistance(sample, mean);
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }

    if (best >= 0 && bestDistance <= threshold) {
      const centre = centres[best]!;
      centre.sum[0] += sample[0];
      centre.sum[1] += sample[1];
      centre.sum[2] += sample[2];
      centre.count++;
    } else if (centres.length < max) {
      centres.push({ sum: [...sample], count: 1 });
    }
  }

  // A cluster made of a handful of stray pixels is a detail of the subject
  // poking into the border, not a background colour.
  const floor = Math.max(1, samples.length * 0.04);
  return centres
    .filter((c) => c.count >= floor)
    .map((c): Colour => [c.sum[0] / c.count, c.sum[1] / c.count, c.sum[2] / c.count]);
}

/**
 * Clears the background in place, returning how many pixels it took.
 *
 * Works on the alpha channel only, so the colours underneath survive for a
 * feathered edge to blend against.
 */
export function cutBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  options: CutoutOptions = {},
): number {
  const strength = options.strength ?? 1;
  const alphaFloor = options.alphaFloor ?? 8;

  const samples = borderSamples(data, w, h);
  if (samples.length === 0) return 0;
  const centres = clusterColours(samples);
  if (centres.length === 0) return 0;

  const nearest = (i: number): number => {
    const colour: Colour = [data[i]!, data[i + 1]!, data[i + 2]!];
    let best = Infinity;
    for (const centre of centres) {
      const distance = colourDistance(colour, centre);
      if (distance < best) best = distance;
    }
    return best;
  };

  // How far the border itself strays from its own colours is the measure of
  // how much variation this picture's background has.
  const spread = samples
    .map((s) => Math.min(...centres.map((c) => colourDistance(s, c))))
    .sort((a, b) => a - b);
  const p90 = spread[Math.floor(spread.length * 0.9)] ?? 0;
  const hard = Math.max(28, Math.min(150, p90 * 1.6 + 24)) * strength;
  // Beyond the hard edge, a band that is thinned rather than cleared. This is
  // the difference between a cutout and a cut-out-looking cutout.
  const soft = hard * 1.7;

  // Kept so the whole thing can be undone: an image that turns out to be all
  // background is one the flood has misread, not one the player wanted erased.
  const originalAlpha = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) originalAlpha[p] = data[p * 4 + 3]!;

  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }

  let cleared = 0;
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const p = y * w + x;
    if (seen[p]) continue;
    const i = p * 4;
    if (data[i + 3]! < alphaFloor) { seen[p] = 1; continue; }

    const distance = nearest(i);
    if (distance > soft) continue;

    seen[p] = 1;
    if (distance > hard) {
      // Partly background: thinned in proportion to how far into the subject's
      // colours it has travelled. It does not spread the flood — otherwise the
      // softness walks inward a pixel at a time and eats the subject.
      const t = (distance - hard) / (soft - hard);
      data[i + 3] = Math.round(data[i + 3]! * t);
      continue;
    }

    data[i + 3] = 0;
    cleared++;

    if (x > 0) stack.push(x - 1, y);
    if (x < w - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < h - 1) stack.push(x, y + 1);
  }

  // An image the flood consumed entirely is one it has misread — a sticker
  // that is already cut out, or a drawing on a flat field. A small subject on
  // a large wall legitimately clears most of the picture, so the test is
  // whether anything is left at all, not how much came off.
  if (w * h - cleared < w * h * 0.005) {
    for (let p = 0; p < w * h; p++) data[p * 4 + 3] = originalAlpha[p]!;
    return 0;
  }

  featherRim(data, w, h, nearest, hard);
  return cleared;
}

/**
 * Softens the boundary the flood left behind.
 *
 * A threshold produces a hard edge, and a hard edge along an anti-aliased
 * outline keeps a rim of background-coloured pixels — which is the specific
 * thing that makes a cutout look cut out. Any kept pixel that touches a
 * cleared one is faded by how close it still is to the background's own
 * colour, which thins that rim without touching anything further in.
 */
function featherRim(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  nearest: (i: number) => number,
  hard: number,
): void {
  const edges: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (data[p * 4 + 3]! === 0) continue;
      const touchesCleared =
        (x > 0 && data[(p - 1) * 4 + 3]! === 0) ||
        (x < w - 1 && data[(p + 1) * 4 + 3]! === 0) ||
        (y > 0 && data[(p - w) * 4 + 3]! === 0) ||
        (y < h - 1 && data[(p + w) * 4 + 3]! === 0);
      if (touchesCleared) edges.push(p);
    }
  }

  // Collected first, then applied: fading as we go would let one faded pixel
  // count as cleared for the next and walk the softness inward.
  for (const p of edges) {
    const i = p * 4;
    const distance = nearest(i);
    const t = Math.max(0.3, Math.min(1, (distance - hard) / (hard * 2)));
    data[i + 3] = Math.round(data[i + 3]! * t);
  }
}
