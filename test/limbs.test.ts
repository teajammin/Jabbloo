/**
 * Limb-detection tests.
 *
 * The rule the brief asks for: use the limbs a player drew, and only fall back
 * to procedural ones for characters that have none. Getting that wrong in
 * either direction is visible — a second arm drawn over a drawn arm, or a
 * kick with nothing to kick with — so the shapes here are the ones players
 * actually produce: a bean, a stick figure, a blob with one arm out.
 */
import { detectLimbs, type Silhouette } from '../src/engine/limbs';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const W = 96, H = 96;

/** A blank silhouette plus a painter, so each shape reads like a drawing. */
function sheet(): Silhouette & { rect: (x: number, y: number, w: number, h: number) => void } {
  const alpha = new Uint8Array(W * H);
  return {
    width: W, height: H, alpha,
    rect(x, y, w, h) {
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          if (px >= 0 && px < W && py >= 0 && py < H) alpha[py * W + px] = 1;
        }
      }
    },
  };
}

// A bean: one solid body, no limbs at all.
const bean = sheet();
bean.rect(34, 14, 28, 70);
const beanFound = detectLimbs(bean);
check('a bean has no arms', beanFound.arms === false);
check('a bean has no legs', beanFound.legs === false);
check('and so keeps the default anchor', beanFound.hand === null);

// A stick figure: torso, two arms out, two legs with daylight between them.
const figure = sheet();
figure.rect(42, 12, 12, 44);          // torso
figure.rect(18, 30, 60, 6);           // arms
figure.rect(42, 56, 5, 30);           // left leg
figure.rect(51, 56, 5, 30);           // right leg
const figureFound = detectLimbs(figure);
check('a stick figure has arms', figureFound.arms === true);
check('a stick figure has legs', figureFound.legs === true);
check('the hand is out at the end of an arm',
  figureFound.hand !== null && Math.abs(figureFound.hand.x) > 0.4,
  JSON.stringify(figureFound.hand));
check('and level with the arm, not the head',
  figureFound.hand !== null && figureFound.hand.y > -0.5 && figureFound.hand.y < 0.2,
  JSON.stringify(figureFound.hand));

// Legs but no arms: the leg rig steps back, the arm rig stays.
const legsOnly = sheet();
legsOnly.rect(38, 12, 20, 46);
legsOnly.rect(38, 58, 7, 28);
legsOnly.rect(51, 58, 7, 28);
const legsFound = detectLimbs(legsOnly);
check('legs alone are found', legsFound.legs === true);
check('and are not mistaken for arms', legsFound.arms === false);

// One arm out to the left: the hand should be on that side.
const oneArm = sheet();
oneArm.rect(40, 14, 22, 68);
oneArm.rect(10, 34, 32, 7);
const oneArmFound = detectLimbs(oneArm);
check('a single arm is found', oneArmFound.arms === true);
check('and the hand is on the side it sticks out',
  oneArmFound.hand !== null && oneArmFound.hand.x < -0.2, JSON.stringify(oneArmFound.hand));

// A shoulder bulge is not an arm.
const bulge = sheet();
bulge.rect(36, 14, 24, 68);
bulge.rect(32, 26, 32, 10);
check('a wide shoulder is not an arm', detectLimbs(bulge).arms === false);

// A cape or skirt splitting near the bottom is not a pair of legs unless the
// split runs down the figure.
const skirt = sheet();
skirt.rect(34, 12, 28, 74);
skirt.rect(46, 84, 4, 2);
check('a single nick at the hem is not legs', detectLimbs(skirt).legs === false);

// Degenerate input must never throw or claim limbs.
check('nothing at all is handled', detectLimbs(null).arms === false);
check('an empty sheet is handled', detectLimbs(sheet()).legs === false);
check('a tiny sheet is handled',
  detectLimbs({ width: 4, height: 4, alpha: new Uint8Array(16).fill(1) }).arms === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
