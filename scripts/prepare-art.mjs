/**
 * Turns dropped artwork into sprites the game can use.
 *
 * Artwork arrives as whatever came out of whatever made it: a webp with no
 * transparency, three thousand pixels square, the subject floating on a flat
 * background. A sprite has to be a PNG, has to be transparent everywhere it is
 * not the thing, and has to be small enough that fifty-seven of them are not a
 * download. This does that, and says what it did to each one.
 *
 * The background is removed by flooding inward from the edges rather than by
 * matching a colour everywhere — a white shirt in the middle of a picture is
 * not background, and a global key punches a hole in it.
 *
 * Runs in headless Chrome because that is the image decoder already on this
 * machine: it reads webp, heic and everything else without a dependency, and a
 * canvas is the shortest path from "pixels" to "pixels with some removed".
 *
 *   node scripts/prepare-art.mjs [--dry]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const incoming = join(root, 'incoming-art');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DRY = process.argv.includes('--dry');

/** The longest edge a sprite ships at. Big enough to fill a stage, small enough to load. */
const MAX_EDGE = 320;

/** How far a pixel may stray from the background colour and still count as it. */
const TOLERANCE = 42;

/**
 * Where each dropped file belongs.
 *
 * Most match a sprite by name. These are the ones that do not: what somebody
 * calls a picture and what the engine calls the slot are different
 * vocabularies, and guessing silently is how a fart ends up as a weapon.
 */
const ALIASES = {
  fart: 'stink',
  first: 'fist',
  lighting: 'bolt',
  lightning: 'bolt',
  heart: 'hearts',
  axe: 'placeholder-weapon-axe',
  sword: 'placeholder-weapon-sword',
  hammer: 'placeholder-weapon-hammer',
};

/*
 * What slots there are to fill, read from the folder itself.
 *
 * Either extension counts: sprites ship as webp, but a run that was
 * interrupted between writing and compressing leaves PNGs behind, and a
 * dropped file should still find its slot.
 */
const effectIds = new Set(
  readdirSync(join(root, 'public', 'effects'))
    .filter((f) => f.endsWith('.png') || f.endsWith('.webp'))
    .map((f) => basename(f, extname(f))),
);

const files = readdirSync(incoming)
  .filter((f) => /\.(png|jpe?g|webp|heic|gif|bmp)$/i.test(f))
  .sort();

if (files.length === 0) {
  console.log('nothing in incoming-art/');
  process.exit(0);
}

// --- somewhere Chrome can read them from ----------------------------------
const work = mkdtempSync(join(tmpdir(), 'jabbloo-art-'));
const jobs = [];

for (const file of files) {
  const id = basename(file, extname(file)).toLowerCase();
  const target = ALIASES[id] ?? id;
  const isEffect = effectIds.has(target);
  const isPlaceholder = target.startsWith('placeholder-');

  if (!isEffect && !isPlaceholder) {
    jobs.push({ file, target, skip: `no sprite called "${target}"` });
    continue;
  }

  const copy = join(work, file);
  writeFileSync(copy, readFileSync(join(incoming, file)));
  jobs.push({
    file,
    target,
    url: `/${encodeURIComponent(file)}`,
    out: isPlaceholder
      ? join(root, 'public', `${target}.png`)
      : join(root, 'public', 'effects', `${target}.png`),
  });
}

const runnable = jobs.filter((j) => !j.skip);
for (const skipped of jobs.filter((j) => j.skip)) {
  console.log(`  skip  ${skipped.file} — ${skipped.skip}`);
}
if (runnable.length === 0) { rmSync(work, { recursive: true, force: true }); process.exit(0); }

// --- a browser to do the pixels -------------------------------------------
/*
 * Served over http rather than opened as files.
 *
 * A canvas that has drawn a file:// image cannot be read back — the pixels are
 * there and getImageData refuses to hand them over — and a page at about:blank
 * is not allowed to load them at all. One socket on localhost sidesteps both.
 */
const TYPES = {
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.heic': 'image/heic', '.html': 'text/html',
};
const server = createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1).split('?')[0]);
  if (name === '' || name === 'index.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>art</title>');
    return;
  }
  const path = join(work, basename(name));
  if (!existsSync(path)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = join(work, 'chrome');
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=9333',
  `--user-data-dir=${profile}`,
  origin,
], { stdio: 'ignore', detached: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);

const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const n = ++seq; pending.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  }
  return r.result?.result?.value;
};

await send('Runtime.enable');

/** The work itself, in the page: cut the background out, trim, scale. */
const PREPARE = `async (url, maxEdge, tolerance) => {
  const img = new Image();
  img.src = url;
  await img.decode();

  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;

  const at = (x, y) => (y * w + x) * 4;
  const alreadyClear = () => {
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
    return false;
  };

  let removed = 0;
  const hadAlpha = alreadyClear();

  if (!hadAlpha) {
    /*
     * The background colour, from the corners.
     *
     * Four corners rather than one, so a picture with something in one corner
     * is not mistaken for a picture of that thing.
     */
    const corners = [[0,0],[w-1,0],[0,h-1],[w-1,h-1]].map(([x,y]) => {
      const i = at(x, y);
      return [px[i], px[i+1], px[i+2]];
    });
    const bg = [0,1,2].map((ch) =>
      Math.round(corners.reduce((sum, c2) => sum + c2[ch], 0) / corners.length));

    const near = (i) => {
      const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i+1] - bg[1]) + Math.abs(px[i+2] - bg[2]);
      return d <= tolerance * 3;
    };

    /*
     * Flooded from the edges inward rather than matched everywhere.
     *
     * A white shirt in the middle of a picture is not background, and keying
     * every matching pixel punches a hole through it. Only what the outside
     * can reach is outside.
     */
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, 0); stack.push(x, h - 1); }
    for (let y = 0; y < h; y++) { stack.push(0, y); stack.push(w - 1, y); }

    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const k = y * w + x;
      if (seen[k]) continue;
      const i = k * 4;
      if (!near(i)) continue;
      seen[k] = 1;
      px[i + 3] = 0;
      removed++;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }

    /*
     * A one-pixel softening pass on the new edge.
     *
     * A hard key leaves a fringe of background colour a pixel wide, which on a
     * dark battleground reads as a white outline around everything.
     */
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        if (seen[k]) continue;
        const i = k * 4;
        let clear = 0;
        if (seen[k - 1]) clear++;
        if (seen[k + 1]) clear++;
        if (seen[k - w]) clear++;
        if (seen[k + w]) clear++;
        if (clear >= 2) px[i + 3] = Math.min(px[i + 3], 140);
        else if (clear === 1) px[i + 3] = Math.min(px[i + 3], 210);
      }
    }
  }

  ctx.putImageData(image, 0, 0);

  // Trim to what is left, so the sprite is the artwork and not its margins.
  let left = w, right = -1, top = h, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[at(x, y) + 3] < 24) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) { left = 0; top = 0; right = w - 1; bottom = h - 1; }

  const cw = right - left + 1, ch = bottom - top + 1;
  const scale = Math.min(1, maxEdge / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(cw * scale));
  out.height = Math.max(1, Math.round(ch * scale));
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(c, left, top, cw, ch, 0, 0, out.width, out.height);

  /*
   * How much of the trimmed box is still solid.
   *
   * The failure that cannot be seen from here is a cutout that did nothing:
   * the file is written, the run says "ok", and the sprite turns out to be an
   * opaque rectangle sitting on the battleground. A shape that fills its own
   * bounding box completely is almost always that.
   */
  let solid = 0;
  const check = octx.getImageData(0, 0, out.width, out.height).data;
  for (let i = 3; i < check.length; i += 4) if (check[i] > 200) solid++;

  return {
    data: out.toDataURL('image/png'),
    from: w + 'x' + h,
    to: out.width + 'x' + out.height,
    hadAlpha,
    removedPercent: Math.round((removed / (w * h)) * 100),
    fillPercent: Math.round((solid / (out.width * out.height)) * 100),
  };
}`;

console.log(`\npreparing ${runnable.length} files\n`);
const report = [];

for (const job of runnable) {
  try {
    const result = await evaluate(
      `(${PREPARE})(${JSON.stringify(origin + job.url)}, ${MAX_EDGE}, ${TOLERANCE})`);
    const bytes = Buffer.from(result.data.split(',')[1], 'base64');
    if (!DRY) {
      mkdirSync(dirname(job.out), { recursive: true });
      writeFileSync(job.out, bytes);
    }
    const note = result.hadAlpha ? 'already cut out' : `cut out, ${100 - result.fillPercent}% clear`;
    const renamed = job.target !== basename(job.file, extname(job.file)).toLowerCase()
      ? ` → ${job.target}` : '';
    console.log(`  ok    ${job.file}${renamed}  ${result.from} → ${result.to}, ${note}, ${(bytes.length / 1024).toFixed(0)}KB`);
    report.push({ ...job, ...result, bytes: bytes.length });
  } catch (error) {
    console.log(`  FAIL  ${job.file} — ${String(error).slice(0, 90)}`);
  }
}

ws.close();
server.close();
try { process.kill(-chrome.pid); } catch { /* already gone */ }
// Chrome may still be flushing its profile; the folder is disposable either way.
try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
catch { /* the OS will get it */ }

const suspicious = report.filter((r) => r.fillPercent > 94);
if (suspicious.length) {
  console.log('\nworth a look — these still fill their own bounding box, which usually');
  console.log('means the background was not flat enough to remove:');
  for (const s of suspicious) console.log(`  ${s.file} (${s.fillPercent}% solid)`);
}
if (DRY) {
  console.log('\n(dry run — nothing written)');
} else {
  console.log(`\nwrote ${report.length} sprites`);
  // Sprites ship as webp; a PNG left behind is a file nothing loads.
  const compress = join(here, 'compress-effects.mjs');
  if (existsSync(compress)) {
    console.log();
    spawn(process.execPath, [compress], { stdio: 'inherit' })
      .on('exit', (code) => process.exit(code ?? 0));
  }
}
