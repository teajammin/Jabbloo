/**
 * Cropping a drawing to what was actually drawn.
 *
 * Every drawing arrives as a whole square canvas however much of it somebody
 * used, so a weapon sketched in one corner came out a sliver on the fighter's
 * hand while somebody who filled the page got a broadsword — the difference
 * being how boldly they drew rather than anything about the weapon.
 *
 * Tested on the geometry rather than on pixels, the same way `findGrip` is:
 * measuring ink needs a real canvas, deciding what to do about it does not.
 */
import { inkBounds } from '../src/engine/trim';
import type { Silhouette } from '../src/engine/limbs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const W = 100, H = 100;

/** A sheet with a rectangle of ink on it, given as fractions. */
function sheet(x = 0, y = 0, w = 0, h = 0): Silhouette {
  const alpha = new Uint8Array(W * H);
  for (let py = Math.round(y * H); py < Math.round((y + h) * H); py++) {
    for (let px = Math.round(x * W); px < Math.round((x + w) * W); px++) {
      if (px >= 0 && px < W && py >= 0 && py < H) alpha[py * W + px] = 1;
    }
  }
  return { width: W, height: H, alpha };
}

const corner = inkBounds(sheet(0.06, 0.06, 0.14, 0.14));
check('a drawing in one corner is cropped to it',
  (corner?.width ?? 1) < 0.3 && (corner?.height ?? 1) < 0.3,
  JSON.stringify(corner));
check('and the crop sits where the ink was',
  (corner?.x ?? 1) < 0.2 && (corner?.y ?? 1) < 0.2, JSON.stringify(corner));

check('a drawing that fills the page is left alone',
  inkBounds(sheet(0, 0, 1, 1)) === null);

const blade = inkBounds(sheet(0.45, 0.1, 0.1, 0.8));
check('a long thin drawing stays long and thin',
  (blade?.height ?? 0) > (blade?.width ?? 1) * 3, JSON.stringify(blade));

// The whole point: the same shape drawn small and drawn large has to come out
// as the same shape, so the size on the fighter stops depending on how boldly
// somebody drew.
const ratio = (b: { width: number; height: number } | null) =>
  b ? b.width / b.height : 0;
const small = inkBounds(sheet(0.4, 0.4, 0.06, 0.15));
const large = inkBounds(sheet(0.2, 0.1, 0.24, 0.6));
check('the same shape drawn small and large crops to the same shape',
  Math.abs(ratio(small) - ratio(large)) < 0.12,
  `${ratio(small).toFixed(2)} vs ${ratio(large).toFixed(2)}`);

// Room around the ink, so a trimmed weapon is not cropped to its own outline.
check('a little breathing room is left around it',
  (corner?.x ?? 1) < 0.06 && (corner?.width ?? 0) > 0.14, JSON.stringify(corner));

// The crop can never ask for more than the drawing has.
const edge = inkBounds(sheet(0.9, 0.9, 0.1, 0.1));
check('a crop against the edge stays inside the drawing',
  edge !== null && edge.x + edge.width <= 1.0001 && edge.y + edge.height <= 1.0001,
  JSON.stringify(edge));

// Nothing that could throw may throw: these are player drawings.
check('an empty drawing is left alone', inkBounds(sheet()) === null);
check('a single stray dot is not blown up to a sword',
  inkBounds(sheet(0.5, 0.5, 0.01, 0.01)) === null);
check('an image that cannot be measured is left alone', inkBounds(null) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
