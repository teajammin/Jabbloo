/**
 * Fetches the heart from OpenMoji and rasterises it.
 *
 * The heart the game drew for itself was a procedural blob, and it looked like
 * one — which matters more here than for most effects, because a heart is a
 * shape everybody already knows and a wrong one reads as a mistake rather than
 * a style.
 *
 * OpenMoji is CC BY-SA 4.0; the credit is in the options menu with the others.
 * Rasterised through headless Chrome because that is the SVG renderer already
 * on this machine, and the result is committed so a build never needs either.
 *
 *   node scripts/fetch-heart.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'effects');

/** The emoji to fetch, and what the game calls it. */
const WANTED = [
  { code: '2764', name: 'hearts', size: 240 },
];

const work = mkdtempSync(join(tmpdir(), 'jabbloo-art-'));

for (const { code, name, size } of WANTED) {
  const response = await fetch(`https://openmoji.org/data/color/svg/${code}.svg`);
  if (!response.ok) throw new Error(`${code}: ${response.status}`);
  const svg = await response.text();

  // A page exactly the size of the image, with nothing else on it, so the
  // screenshot is the artwork and no cropping is needed afterwards.
  const page = join(work, `${name}.html`);
  writeFileSync(page, `<!doctype html><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent}
    svg{width:${size}px;height:${size}px;display:block}
  </style>${svg}`);

  const png = join(out, `${name}.png`);
  execFileSync(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--hide-scrollbars',
    // Transparent, or the heart arrives on a white card.
    '--default-background-color=00000000',
    `--screenshot=${png}`,
    `--window-size=${size},${size}`,
    `--user-data-dir=${join(work, 'chrome')}`,
    `file://${page}`,
  ], { stdio: 'ignore' });

  console.log(`${name}.png — ${(readFileSync(png).length / 1024).toFixed(0)}KB`);
}

rmSync(work, { recursive: true, force: true });
