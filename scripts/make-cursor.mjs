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
import { Canvas, encodePng, capsule, ellipse, star, minus, any, all, C } from './lib/raster.mjs';

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
// Palette for the axe specifically: silver blades, gold collar, rust handle.
const STEEL = [214, 217, 222];
const STEEL_DARK = [140, 148, 160];
const RUST = [178, 84, 56];
const GOLD = [252, 196, 68];

/**
 * A double-bladed battle axe, matching the reference art.
 *
 * Each blade is a disc with a disc bitten out of its inner side, giving the
 * curved cutting edge; the two are mirrored about the head so they read as one
 * symmetric head rather than two separate crescents.
 *
 * @param s pixels of the square canvas
 */
function axe(s) {
  const c = new Canvas(s, s);
  const u = s / 176;              // authored at 176px, scaled to fit
  const px = (v) => v * u;
  const o = px(8);                // outline weight

  const hx = px(76), hy = px(76); // head centre

  // --- handle, drawn first so the head covers the joint --------------------
  const gripA = [px(80), px(80), px(150), px(150)];
  c.fill(capsule(...gripA, px(12) + o), [40, 38, 46]);
  c.fill(capsule(...gripA, px(12)), RUST);
  c.fill(capsule(px(96), px(96), px(138), px(138), px(3.5)), C.white, 0.28);

  // Gold band partway down the shaft.
  c.fill(capsule(px(106), px(106), px(122), px(122), px(12) + o * 0.8), [40, 38, 46]);
  c.fill(capsule(px(106), px(106), px(122), px(122), px(12)), GOLD);

  // Pommel.
  c.fill(ellipse(px(152), px(152), px(13) + o, px(13) + o), [40, 38, 46]);
  c.fill(ellipse(px(152), px(152), px(13), px(13)), STEEL);

  // --- blades ---------------------------------------------------------------
  // The handle runs down-right, so the two bits flare perpendicular to it:
  // one up-right, one down-left. Offsetting them along the handle instead makes
  // the crescents overlap and fill in as a single disc.
  // The bite must swallow the blade's own centre, or the subtraction leaves a
  // near-whole disc rather than a crescent.
  const R = px(46), BITE = px(56), off = px(28), back = px(4);

  const upA = [hx + off, hy - off];        // up-right bit
  const upBite = [hx - back, hy + back];
  const dnA = [hx - off, hy + off];        // down-left bit
  const dnBite = [hx + back, hy - back];

  const bladeA = minus(ellipse(upA[0], upA[1], R, R), ellipse(upBite[0], upBite[1], BITE, BITE));
  const bladeB = minus(ellipse(dnA[0], dnA[1], R, R), ellipse(dnBite[0], dnBite[1], BITE, BITE));

  const outlineA = minus(
    ellipse(upA[0], upA[1], R + o, R + o),
    ellipse(upBite[0], upBite[1], BITE - o * 0.5, BITE - o * 0.5),
  );
  const outlineB = minus(
    ellipse(dnA[0], dnA[1], R + o, R + o),
    ellipse(dnBite[0], dnBite[1], BITE - o * 0.5, BITE - o * 0.5),
  );

  c.fill(any(outlineA, outlineB), [40, 38, 46]);
  c.fill(any(bladeA, bladeB), STEEL);

  // Shade the inner half of each bit, shine along the outer cutting edge.
  c.fill(all(bladeA, ellipse(hx + px(20), hy - px(20), px(34), px(34))), STEEL_DARK, 0.4);
  c.fill(all(bladeB, ellipse(hx - px(20), hy + px(20), px(34), px(34))), STEEL_DARK, 0.4);
  c.fill(all(bladeA, ellipse(hx + px(48), hy - px(40), px(12), px(8))), C.white, 0.8);
  c.fill(all(bladeB, ellipse(hx - px(40), hy + px(48), px(8), px(12))), C.white, 0.8);

  // --- gold collar where the bits meet the shaft ----------------------------
  c.fill(star(hx, hy, 4, px(9), px(25), Math.PI / 4, 1.6), [40, 38, 46]);
  c.fill(star(hx, hy, 4, px(7), px(20), Math.PI / 4, 1.6), GOLD);

  return c;
}

for (const [name, size] of [['cursor-axe', 44], ['cursor-axe-large', 176]]) {
  const c = axe(size);
  writeFileSync(join(OUT, `${name}.png`), encodePng(size, size, c.buf));
  console.log(`  ${name}.png ${size}x${size}`);
}
