/**
 * Working out how a drawn weapon is held.
 *
 * The shapes here are the ones people actually draw: a sword pointing up, an
 * axe lying sideways, a hammer drawn head-down, a baguette. What is checked is
 * that the hand lands on the handle and the business end ends up pointing away
 * from its owner — and, just as importantly, that a shape with no clear
 * direction is left alone rather than guessed at.
 */
import { findGrip, DEFAULT_GRIP } from '../src/engine/grip';
import type { Silhouette } from '../src/engine/limbs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const W = 96, H = 96;

function sheet(): Silhouette & {
  rect: (x: number, y: number, w: number, h: number) => void;
  disc: (cx: number, cy: number, r: number) => void;
} {
  const alpha = new Uint8Array(W * H);
  const on = (x: number, y: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H) alpha[y * W + x] = 1;
  };
  return {
    width: W, height: H, alpha,
    rect(x, y, w, h) {
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) on(px, py);
    },
    disc(cx, cy, r) {
      for (let py = cy - r; py <= cy + r; py++) {
        for (let px = cx - r; px <= cx + r; px++) {
          if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) on(px, py);
        }
      }
    },
  };
}

/**
 * Whether the weapon ends up pointing away from its owner once turned.
 *
 * `rotation` is how far to turn the drawing, not where it currently points, so
 * this applies it: the line from the grip to the weapon's centre of mass is
 * the direction of its business end, and after the turn that line should run
 * to the right, which is the way the rig swings.
 */
function pointsAwayAfterTurning(mask: Silhouette, grip: { x: number; y: number; rotation: number }) {
  let count = 0, sumX = 0, sumY = 0;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x] !== 1) continue;
      count++; sumX += x; sumY += y;
    }
  }
  const dx = sumX / count - grip.x * mask.width;
  const dy = sumY / count - grip.y * mask.height;
  const turned = dx * Math.cos(grip.rotation) - dy * Math.sin(grip.rotation);
  const length = Math.hypot(dx, dy);
  return length > 0 && turned / length > 0.6;
}

// A sword drawn upright: thin grip at the bottom, blade above.
{
  const p = sheet();
  p.rect(44, 12, 8, 52);   // blade
  p.rect(42, 60, 12, 6);   // crossguard
  p.rect(46, 66, 4, 20);   // grip
  const grip = findGrip(p);

  check('an upright sword is understood', grip.confidence > 0.2, String(grip.confidence.toFixed(2)));
  check('held near the bottom', grip.y > 0.6, String(grip.y.toFixed(2)));
  check('and turned so the blade leads', pointsAwayAfterTurning(p, grip),
    `turn ${(grip.rotation * 180 / Math.PI).toFixed(0)}deg`);
}

// The same sword drawn upside down: blade at the bottom.
{
  const p = sheet();
  p.rect(44, 32, 8, 52);   // blade, low
  p.rect(42, 30, 12, 6);
  p.rect(46, 10, 4, 20);   // grip, high
  const grip = findGrip(p);

  check('an upside-down sword is held by its grip', grip.y < 0.4, String(grip.y.toFixed(2)));
  check('and still turned so the blade leads', pointsAwayAfterTurning(p, grip),
    `turn ${(grip.rotation * 180 / Math.PI).toFixed(0)}deg`);
}

// An axe drawn lying on its side, head to the left.
{
  const p = sheet();
  p.rect(30, 46, 56, 6);   // handle running right
  p.disc(26, 48, 14);      // head on the left
  const grip = findGrip(p);

  check('a sideways axe is understood', grip.confidence > 0.2, String(grip.confidence.toFixed(2)));
  check('held along the handle, away from the head', grip.x > 0.6, String(grip.x.toFixed(2)));
  check('and turned so the head leads', pointsAwayAfterTurning(p, grip),
    `turn ${(grip.rotation * 180 / Math.PI).toFixed(0)}deg`);
}

// A hammer drawn diagonally.
{
  const p = sheet();
  for (let i = 0; i < 54; i++) {
    const x = 22 + i, y = 78 - i;
    p.rect(x, y, 5, 5);
  }
  p.disc(78, 22, 12);
  const grip = findGrip(p);
  check('a diagonal hammer is understood', grip.confidence > 0.15, String(grip.confidence.toFixed(2)));
  check('held at the end away from the head',
    grip.x < 0.5 && grip.y > 0.5, `${grip.x.toFixed(2)}, ${grip.y.toFixed(2)}`);
}

// A shield: round, with no direction to speak of.
{
  const p = sheet();
  p.disc(48, 48, 30);
  const grip = findGrip(p);
  check('a round weapon is left alone', grip.confidence === DEFAULT_GRIP.confidence,
    String(grip.confidence));
  check('and held where the rig would hold it anyway', grip.y === DEFAULT_GRIP.y);
}

// Degenerate input must never throw or produce nonsense.
{
  check('nothing at all is handled', findGrip(null).confidence === 0);
  check('an empty sheet is handled', findGrip(sheet()).confidence === 0);

  const speck = sheet();
  speck.rect(40, 40, 2, 2);
  check('a speck is handled', findGrip(speck).confidence === 0);

  const p = sheet();
  p.rect(10, 46, 76, 5);
  const grip = findGrip(p);
  check('a plain stick gets a sane grip',
    Number.isFinite(grip.x) && Number.isFinite(grip.y) && Number.isFinite(grip.rotation));
  check('within the picture', grip.x >= 0 && grip.x <= 1 && grip.y >= 0 && grip.y <= 1,
    `${grip.x.toFixed(2)}, ${grip.y.toFixed(2)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
