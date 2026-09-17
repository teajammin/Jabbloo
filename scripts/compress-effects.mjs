/**
 * Turns the effect sprites into what actually ships.
 *
 * Every effect is preloaded before a fight can start — the loading screen
 * waits on all of them together — so the folder's total size is time players
 * spend watching a progress bar instead of fighting. As PNGs the painted
 * artwork came to two and a half megabytes; as webp it is under a tenth of
 * that, for a difference nobody can see at the size these are drawn.
 *
 * Each sprite is encoded both ways and the better one kept. Lossless is
 * perfect and, on the small flat shapes the generator draws, usually also
 * smaller — a hard-edged arrow has nothing for a lossy encoder to save. Lossy
 * wins enormously on the painted ones. Choosing per file rather than by rule
 * means neither kind is compromised for the other's benefit.
 *
 *   node scripts/compress-effects.mjs [--keep-png]
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, unlinkSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'public', 'effects');
const KEEP = process.argv.includes('--keep-png');

let cwebp;
try {
  cwebp = execFileSync('which', ['cwebp']).toString().trim();
} catch {
  console.error('cwebp not found — install it with: brew install webp');
  process.exit(1);
}

const sizeOf = (path) => statSync(path).size;
const pngs = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

if (pngs.length === 0) {
  console.log('no PNGs to compress — already done');
  process.exit(0);
}

let before = 0;
let after = 0;
let lossless = 0;

for (const file of pngs) {
  const source = join(dir, file);
  const stem = basename(file, '.png');
  const a = join(dir, `${stem}.lossless.webp`);
  const b = join(dir, `${stem}.lossy.webp`);

  execFileSync(cwebp, ['-quiet', '-lossless', '-z', '9', source, '-o', a]);
  execFileSync(cwebp, ['-quiet', '-q', '82', '-alpha_q', '90', source, '-o', b]);

  const keepLossless = sizeOf(a) <= sizeOf(b);
  const winner = keepLossless ? a : b;
  const loser = keepLossless ? b : a;
  if (keepLossless) lossless++;

  // Measured before anything is removed — the files are about to go away.
  const was = sizeOf(source);
  const now = sizeOf(winner);
  before += was;
  after += now;

  rmSync(loser);
  renameSync(winner, join(dir, `${stem}.webp`));
  if (!KEEP) unlinkSync(source);

  console.log(
    `  ${stem.padEnd(12)} ${String(Math.round(was / 1024)).padStart(4)}KB → `
    + `${String(Math.round(now / 1024)).padStart(4)}KB  ${keepLossless ? 'lossless' : 'lossy'}`,
  );
}

const pct = Math.round((1 - after / before) * 100);
console.log(
  `\n${pngs.length} sprites: ${(before / 1024 / 1024).toFixed(2)}MB → ${(after / 1024).toFixed(0)}KB (${pct}% smaller, ${lossless} lossless)`,
);
if (KEEP) console.log('PNGs kept (--keep-png)');
