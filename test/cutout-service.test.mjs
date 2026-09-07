/**
 * Local cutout service tests.
 *
 * Needs the dev stack: `npm run dev`. Skips itself when the service is not
 * running, because it is optional by design — the game falls back to the
 * browser's own cutout, and a machine without a 168MB model should still be
 * able to run the test suite.
 */
const API = 'http://127.0.0.1:8787';
const SERVICE = 'http://127.0.0.1:8788';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const reachable = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch { return false; }
};

if (!await reachable(`${SERVICE}/health`)) {
  console.log('  --   cutout service not running; skipped (npm run setup:cutout)');
  process.exit(0);
}

/** A subject on a busy background, as a PNG the service can read. */
function testPhoto() {
  // Built with the same rasteriser the game's placeholder art uses.
  return import('../scripts/lib/raster.mjs').then(({ Canvas, encodePng, circle, ellipse, any }) => {
    const W = 240, H = 240;
    const c = new Canvas(W, H);
    c.fill(() => true, [120, 150, 180]);
    for (const [cx, cy, r] of [[40, 40, 26], [200, 50, 30], [50, 200, 28]]) {
      c.fill(circle(cx, cy, r), [80, 110, 140], 0.6);
    }
    c.fill(any(ellipse(120, 150, 46, 62), circle(120, 80, 34)), [214, 96, 84]);
    return Buffer.from(encodePng(W, H, c.buf));
  });
}

const photo = await testPhoto();

// The service itself.
{
  const response = await fetch(`${SERVICE}/cutout`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: photo,
    signal: AbortSignal.timeout(60_000),
  });
  const out = Buffer.from(await response.arrayBuffer());
  check('the service answers', response.status === 200, String(response.status));
  check('with a PNG', out.subarray(1, 4).toString() === 'PNG', out.subarray(0, 8).toString('hex'));
  // Colour type 6 in the header is RGBA: the point of the exercise is alpha.
  check('that carries transparency', out[25] === 6, `colour type ${out[25]}`);

  const empty = await fetch(`${SERVICE}/cutout`, { method: 'POST', body: '' });
  check('an empty body is refused', empty.status === 400, String(empty.status));

  const wrongPath = await fetch(`${SERVICE}/nope`, { method: 'POST', body: 'x' });
  check('an unknown path is a 404', wrongPath.status === 404, String(wrongPath.status));
}

// And through the game's own API, which is how the drawing tool reaches it.
if (await reachable(`${API}/api/health`)) {
  const health = await (await fetch(`${API}/api/health`)).json();
  check('health reports the local service', health.cutout === 'local', String(health.cutout));

  const response = await fetch(`${API}/api/cutout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: `data:image/png;base64,${photo.toString('base64')}` }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  check('the proxy reports it worked', body.available === true, JSON.stringify(body).slice(0, 120));
  check('and hands back a PNG data URL',
    typeof body.image === 'string' && body.image.startsWith('data:image/png;base64,'));

  const cut = Buffer.from(String(body.image).split(',')[1], 'base64');
  check('with transparency intact', cut[25] === 6, `colour type ${cut[25]}`);
  check('and it is not simply the photo handed back', !cut.equals(photo));
} else {
  console.log('  --   game API not running; proxy checks skipped');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
