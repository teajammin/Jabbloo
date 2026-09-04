import type { Texture } from 'pixi.js';

/**
 * Samples a representative colour from a sprite.
 *
 * Used to tint procedural limbs so a drawn-on leg matches whatever the player
 * drew, rather than appearing in an arbitrary colour that reads as a bug.
 */

const FALLBACK = 0xf6c9a8;
const SAMPLE_SIZE = 24;

/** Average of the opaque pixels, ignoring near-white and near-black. */
export function sampleDominantColour(texture: Texture, fallback = FALLBACK): number {
  const source = (texture.baseTexture.resource as { source?: CanvasImageSource })?.source;
  if (!source) return fallback;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;

    ctx.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]!;
      if (alpha < 200) continue;                       // transparent background
      const [pr, pg, pb] = [data[i]!, data[i + 1]!, data[i + 2]!];
      const max = Math.max(pr, pg, pb);
      const min = Math.min(pr, pg, pb);
      if (max > 245 && min > 235) continue;            // white highlights
      if (max < 45) continue;                          // outlines
      r += pr; g += pg; b += pb; n++;
    }

    if (n === 0) return fallback;
    return ((r / n) << 16) | ((g / n) << 8) | (b / n);
  } catch {
    // Canvas can throw on tainted sources; a fallback limb beats no limb.
    return fallback;
  }
}

/** Multiplies a packed colour toward black, for outlines and shading. */
export function darken(colour: number, factor = 0.62): number {
  const r = Math.round(((colour >> 16) & 0xff) * factor);
  const g = Math.round(((colour >> 8) & 0xff) * factor);
  const b = Math.round((colour & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
