/**
 * Background removal tests.
 *
 * Built from images made by hand, because "does this look cut out" is not a
 * question a phone can be asked in a test — but "did it keep the subject and
 * clear the wall" is, if the wall and the subject are known.
 */
import { cutBackground, clusterColours, colourDistance } from '../src/draw/cutout';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const W = 64, H = 64;

interface Picture {
  data: Uint8ClampedArray;
  set: (x: number, y: number, rgb: [number, number, number]) => void;
  alpha: (x: number, y: number) => number;
  fill: (rgb: [number, number, number] | ((x: number, y: number) => [number, number, number])) => void;
  box: (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => void;
}

function picture(): Picture {
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x: number, y: number, rgb: [number, number, number]) => {
    const i = (y * W + x) * 4;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  };
  return {
    data, set,
    alpha: (x, y) => data[(y * W + x) * 4 + 3]!,
    fill(rgb) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) set(x, y, typeof rgb === 'function' ? rgb(x, y) : rgb);
      }
    },
    box(x0, y0, x1, y1, rgb) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rgb);
    },
  };
}

// A subject on a plain wall: the case that has to be perfect.
{
  const p = picture();
  p.fill([230, 230, 235]);              // pale wall
  p.box(20, 20, 44, 44, [180, 60, 60]); // subject
  cutBackground(p.data, W, H);

  check('the wall is cleared', p.alpha(2, 2) === 0, String(p.alpha(2, 2)));
  check('the subject is kept whole', p.alpha(32, 32) === 255, String(p.alpha(32, 32)));
  check('right up to its edge', p.alpha(21, 21) === 255, String(p.alpha(21, 21)));
}

// A subject the same colour as the wall in its middle. A global colour key
// punches a hole here; a flood from the border cannot reach it.
{
  const p = picture();
  p.fill([230, 230, 235]);
  p.box(16, 16, 48, 48, [60, 90, 160]);
  p.box(28, 28, 36, 36, [230, 230, 235]);   // a wall-coloured patch inside
  cutBackground(p.data, W, H);

  check('a wall-coloured patch inside the subject survives',
    p.alpha(32, 32) === 255, String(p.alpha(32, 32)));
  check('while the wall itself goes', p.alpha(1, 1) === 0);
}

// A lit wall: a gradient across the whole background, which a fixed tolerance
// either fails to clear at one end or eats the subject to reach.
{
  const p = picture();
  p.fill((x) => [140 + x * 1.6, 150 + x * 1.4, 160 + x * 1.3]);
  p.box(24, 24, 40, 40, [40, 30, 30]);
  cutBackground(p.data, W, H);

  check('a gradient wall clears at the dark end', p.alpha(1, 32) === 0, String(p.alpha(1, 32)));
  check('and at the light end', p.alpha(W - 2, 32) === 0, String(p.alpha(W - 2, 32)));
  check('with the subject still there', p.alpha(32, 32) === 255, String(p.alpha(32, 32)));
}

// Two backgrounds at once — a wall above, a floor below.
{
  const p = picture();
  p.fill([210, 205, 195]);
  p.box(0, 40, W - 1, H - 1, [90, 70, 55]);   // floor
  p.box(24, 20, 40, 52, [200, 60, 120]);      // subject standing on it
  cutBackground(p.data, W, H);

  check('the wall goes', p.alpha(2, 2) === 0);
  check('and so does the floor', p.alpha(2, H - 2) === 0, String(p.alpha(2, H - 2)));
  check('the subject stands through both', p.alpha(32, 30) === 255 && p.alpha(32, 48) === 255);
}

// The edge is feathered rather than cut with scissors.
{
  const p = picture();
  p.fill([235, 235, 235]);
  // A subject whose edge blurs into the wall over several pixels, as a photo
  // taken at arm's length does. A hard threshold leaves the outer half of that
  // blur behind as a halo.
  for (let y = 16; y < 48; y++) {
    for (let x = 16; x < 48; x++) {
      const edge = Math.min(x - 16, 47 - x, y - 16, 47 - y);
      const t = Math.min(1, edge / 8);
      p.set(x, y, [235 - t * 175, 235 - t * 175, 235 - t * 155]);
    }
  }
  cutBackground(p.data, W, H);

  const rim = [];
  for (let x = 12; x < 22; x++) rim.push(p.alpha(x, 32));
  check('the rim is graded, not binary',
    rim.some((a) => a > 0 && a < 255), JSON.stringify(rim));
  check('the middle is untouched', p.alpha(32, 32) === 255);
}

// A picture that is all one subject and no background at all must survive.
{
  const p = picture();
  p.fill([120, 40, 200]);
  const cleared = cutBackground(p.data, W, H);
  check('an edge-to-edge subject is not wiped out',
    cleared === 0 || p.alpha(32, 32) === 255, `${cleared} cleared`);
}

// The pieces underneath.
{
  check('distance is zero for a colour and itself',
    colourDistance([12, 34, 56], [12, 34, 56]) === 0);
  check('and grows with difference',
    colourDistance([0, 0, 0], [255, 255, 255]) > colourDistance([0, 0, 0], [40, 40, 40]));

  const twoWalls = [
    ...Array.from({ length: 50 }, () => [200, 200, 200] as [number, number, number]),
    ...Array.from({ length: 50 }, () => [40, 60, 90] as [number, number, number]),
  ];
  check('two distinct backgrounds cluster as two', clusterColours(twoWalls).length === 2,
    JSON.stringify(clusterColours(twoWalls)));
  const oneWall = Array.from({ length: 80 }, () => [200, 200, 200] as [number, number, number]);
  check('one background clusters as one', clusterColours(oneWall).length === 1);
  check('a stray colour is not made into a background',
    clusterColours([...oneWall, [255, 0, 0]]).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
