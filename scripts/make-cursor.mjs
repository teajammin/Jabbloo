/**
 * Draws the axe cursor.
 *
 *   cursor-axe.png        44px — the CSS cursor, used before JS loads and on
 *                         devices where the follower is disabled
 *   cursor-axe-large.png  176px — the DOM follower that actually swings
 *
 *   node scripts/make-cursor.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, encodePng, capsule, ellipse, minus, any, darken, C } from './lib/raster.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT, { recursive: true });

/**
 * The axe, drawn at any size.
 *
 * Blade at the top-left so the cutting edge sits under the pointer hotspot;
 * handle running down to the lower right, the way a held axe reads.
 *
 * @param s pixels of the square canvas
 */
function axe(s) {
  const c = new Canvas(s, s);
  const u = s / 176;            // authored at 176px, scaled to fit
  const px = (v) => v * u;
  const o = px(9);              // outline weight

  // Handle, drawn first so the collar covers where it meets the head.
  c.fill(capsule(px(60), px(86), px(152), px(158), px(13) + o * 0.5), darken(C.peach, 0.5));
  c.fill(capsule(px(60), px(86), px(152), px(158), px(13)), C.peach);
  c.fill(capsule(px(84), px(108), px(140), px(148), px(4)), C.white, 0.3);

  // Head: a disc with a large disc bitten out of its right side. What is left
  // is a fat crescent — convex cutting edge on the outside, concave behind.
  // The bite has to be big and close, or the result reads as a mallet.
  // Taller than wide, and the bite sits close enough to leave a slim crescent —
  // a shallow bite on a round disc reads as a mallet, not an axe.
  const blade = minus(
    ellipse(px(58), px(74), px(52), px(66)),
    ellipse(px(118), px(74), px(72), px(82)),
  );
  const bladeGrow = minus(
    ellipse(px(58), px(74), px(52) + o, px(66) + o),
    ellipse(px(118), px(74), px(72) - o * 0.5, px(82) - o * 0.5),
  );
  c.fill(bladeGrow, darken(C.sky, 0.5));
  c.fill(blade, C.sky);
  c.fill(ellipse(px(26), px(56), px(7), px(15)), C.white, 0.55);

  // Collar binding head to handle.
  c.fill(ellipse(px(54), px(80), px(18) + o * 0.6, px(18) + o * 0.6), darken(C.butter, 0.5));
  c.fill(ellipse(px(54), px(80), px(18), px(18)), C.butter);
  c.fill(ellipse(px(48), px(74), px(6), px(5)), C.white, 0.5);

  return c;
}

for (const [name, size] of [['cursor-axe', 44], ['cursor-axe-large', 176]]) {
  const c = axe(size);
  writeFileSync(join(OUT, `${name}.png`), encodePng(size, size, c.buf));
  console.log(`  ${name}.png ${size}x${size}`);
}
