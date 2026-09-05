/**
 * Draws the axe cursor.
 *
 *   cursor-axe.png        44px — the CSS cursor, used before JS loads and
 *                         wherever the animated follower is disabled
 *   cursor-axe-large.png  176px — the DOM follower that actually swings
 *
 * Flat style with no dark outline, matching the reference art: a gold
 * double-bit head with a pale inner bevel, a steel shaft with red diamond
 * bindings, and a red arrowhead pommel.
 *
 *   node scripts/make-cursor.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, encodePng, capsule, ellipse, star, minus, any } from './lib/raster.mjs';

/**
 * A diamond: a square on its corner.
 *
 * star() with a small inner radius gives needle spikes — an X, not a diamond.
 * Straight edges need the inner radius at about 0.72 of the outer, which is
 * where linear interpolation between the two approximates |x|+|y| <= r.
 */
const diamond = (x, y, r) => star(x, y, 4, r * 0.72, r, Math.PI / 4, 1);

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT, { recursive: true });

const GOLD = [255, 184, 28];
const CREAM = [255, 240, 186];
const STEEL = [176, 178, 182];
const STEEL_LIGHT = [214, 216, 220];
const RED = [232, 56, 44];

/**
 * @param s pixels of the square canvas
 *
 * The shaft runs bottom-left to top-right, so the two bits flare perpendicular
 * to it — up-left and down-right. Each is a disc with a larger disc bitten out
 * of its inner side; the bite has to swallow the blade's own centre or the
 * result is a disc with a nick rather than a crescent.
 */
function axe(s) {
  const c = new Canvas(s, s);
  const u = s / 176;
  const px = (v) => v * u;

  // --- shaft ---------------------------------------------------------------
  c.fill(capsule(px(26), px(150), px(146), px(30), px(7.5)), STEEL);
  c.fill(capsule(px(30), px(146), px(142), px(34), px(2.6)), STEEL_LIGHT);

  // Pommel and tip.
  c.fill(diamond(px(20), px(156), px(15)), RED);
  c.fill(diamond(px(150), px(26), px(11)), RED);

  // --- head ----------------------------------------------------------------
  // Each bit is a bar lying ALONG the shaft, offset out to one side, with a
  // circle centred on the shaft carving its inner edge concave. Biting one
  // disc out of another instead pushes the blades away from the shaft, because
  // the bite has to be large enough to hollow the disc and takes the middle
  // with it.
  const hx = px(88), hy = px(88);
  const k = 0.7071;
  const outA = px(42), Rb = px(62), waist = px(46);
  const ox = outA * k;

  // Each bit is a disc set out to one side of the shaft, with a circle centred
  // ON the shaft carving its inner edge. That yields a fan — fat at the cutting
  // edge, tapering where it meets the haft. Carving with a disc centred on the
  // OPPOSITE bit instead pushes both blades away from the shaft entirely.
  const bit = (sign, r, cut) => minus(
    ellipse(hx + sign * ox, hy + sign * ox, r, r),
    ellipse(hx, hy, cut, cut),
  );

  c.fill(any(bit(-1, Rb, waist), bit(1, Rb, waist)), GOLD);
  c.fill(any(bit(-1, Rb - px(11), waist + px(8)), bit(1, Rb - px(11), waist + px(8))), CREAM);

  // --- bindings ------------------------------------------------------------
  // Redrawn over the head so the shaft reads as passing through it.
  c.fill(capsule(px(70), px(106), px(106), px(70), px(7.5)), STEEL);
  c.fill(capsule(px(73), px(103), px(103), px(73), px(2.6)), STEEL_LIGHT);
  c.fill(diamond(px(62), px(114), px(13)), RED);
  c.fill(diamond(px(114), px(62), px(13)), RED);

  return c;
}

for (const [name, size] of [['cursor-axe', 44], ['cursor-axe-large', 176]]) {
  const c = axe(size);
  writeFileSync(join(OUT, `${name}.png`), encodePng(size, size, c.buf));
  console.log(`  ${name}.png ${size}x${size}`);
}
