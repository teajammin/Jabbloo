import { Rectangle, Texture } from 'pixi.js';
import { silhouetteOf, type Silhouette } from './limbs';

/**
 * Cropping a drawing down to what was actually drawn.
 *
 * Every drawing arrives as a square the size of the canvas, and how much of
 * that square somebody used is entirely up to them. A weapon sketched in one
 * corner came out as a sliver on the fighter's hand while somebody who filled
 * the page got a broadsword — the difference being how confidently they drew
 * rather than anything about the weapon.
 *
 * Trimming to the ink and scaling that makes the size mean the same thing for
 * everybody: a small drawing and a large one become the same weapon, which is
 * what nobody expects until they see the alternative.
 */

/** How much of a drawing has to be ink before it is worth trimming to. */
const MIN_COVERAGE = 0.0015;

/** Breathing room left around the ink, as a fraction of the trimmed size. */
const PADDING = 0.04;

/**
 * A view of the same texture, cropped to the drawn part.
 *
 * Returns the original where there is nothing to gain: an empty drawing, a
 * drawing that already fills its canvas, or an image this cannot measure —
 * a photograph from another origin taints the canvas and throws.
 *
 * A frame on the same base texture rather than a copy, so this costs no
 * memory and no upload: it is the same pixels, read through a window.
 */
export function trimToInk(texture: Texture): Texture {
  const bounds = inkBounds(silhouetteOf(texture));
  if (!bounds) return texture;

  const frame = new Rectangle(
    Math.round(bounds.x * texture.width),
    Math.round(bounds.y * texture.height),
    Math.max(1, Math.round(bounds.width * texture.width)),
    Math.max(1, Math.round(bounds.height * texture.height)),
  );

  try {
    return new Texture(texture.baseTexture, frame);
  } catch {
    // A frame outside the base texture throws; the untrimmed drawing is fine.
    return texture;
  }
}

/**
 * Where the ink is, as fractions of the drawing, or null to leave it alone.
 *
 * Separated from the texture so it can be tested against shapes built by hand
 * rather than judged by eye on a fighter — the same split `findGrip` uses, and
 * for the same reason: measuring pixels needs a real canvas and the geometry
 * does not.
 */
export function inkBounds(
  mask: Silhouette | null,
): { x: number; y: number; width: number; height: number } | null {
  if (!mask) return null;

  let left = mask.width;
  let right = -1;
  let top = mask.height;
  let bottom = -1;
  let inked = 0;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x] !== 1) continue;
      inked++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  // Nothing drawn, or so little that trimming to it would blow a stray dot up
  // to the size of a sword.
  if (right < left || bottom < top) return null;
  if (inked / (mask.width * mask.height) < MIN_COVERAGE) return null;

  // The mask is a small sample of the texture, so the bounds come back as
  // fractions and are applied to the real thing.
  const fx = left / mask.width;
  const fy = top / mask.height;
  const fw = (right - left + 1) / mask.width;
  const fh = (bottom - top + 1) / mask.height;

  // Already using the whole canvas: cropping would only shave the edges off.
  if (fw > 0.97 && fh > 0.97) return null;

  const pad = Math.max(fw, fh) * PADDING;
  const x = Math.max(0, fx - pad);
  const y = Math.max(0, fy - pad);

  return {
    x,
    y,
    width: Math.min(1 - x, fw + pad * 2),
    height: Math.min(1 - y, fh + pad * 2),
  };
}
