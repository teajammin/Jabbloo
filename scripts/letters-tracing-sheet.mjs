/**
 * Builds a large labelled sheet of every glyph, for marking up by hand.
 *
 * Each letter sits in its own cell on a light grid, at the same scale, so
 * corrections traced over one letter are directly comparable to the next.
 *
 *   node scripts/letters-tracing-sheet.mjs [cellSize]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Canvas, encodePng } from './lib/raster.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LETTERS = join(ROOT, 'public', 'letters');
const CELL = Number(process.argv[2]) || 300;
const COLS = 6;

const ORDER = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  'excl','query','dot','comma',
];

// Decode every glyph in one Swift invocation: the script recompiles on each
// run, and raw pixels are far too large to pipe back through stdout.
const RAW = join(ROOT, 'node_modules', '.cache', 'letters-raw');
execFileSync('swift', [
  join(ROOT, 'scripts', 'png-to-raw.swift'), RAW,
  ...ORDER.map((n) => join(LETTERS, `${n}.png`)),
], { stdio: 'inherit' });

function loadRGBA(name) {
  const buf = readFileSync(join(RAW, `${name}.raw`));
  return { w: buf.readUInt32LE(0), h: buf.readUInt32LE(4), px: buf.subarray(8) };
}

const rows = Math.ceil(ORDER.length / COLS);
const sheet = new Canvas(COLS * CELL, rows * CELL + 40);

// Light grid, so proportions are readable when tracing.
const GRID = [232, 230, 236];
for (let y = 0; y < sheet.height; y++) {
  for (let x = 0; x < sheet.width; x++) {
    const onCell = x % CELL === 0 || y % CELL === 0;
    const onQuarter = x % (CELL / 4) === 0 || y % (CELL / 4) === 0;
    const i = (y * sheet.width + x) * 4;
    const c = onCell ? [180, 176, 190] : onQuarter ? GRID : [255, 255, 255];
    sheet.buf[i] = c[0]; sheet.buf[i + 1] = c[1]; sheet.buf[i + 2] = c[2]; sheet.buf[i + 3] = 255;
  }
}

ORDER.forEach((name, index) => {
  const { w, h, px } = loadRGBA(name);
  const col = index % COLS, row = Math.floor(index / COLS);
  const inner = CELL - 44;
  const k = Math.min(inner / w, inner / h);
  const dw = Math.round(w * k), dh = Math.round(h * k);
  const ox = col * CELL + Math.round((CELL - dw) / 2);
  const oy = row * CELL + Math.round((CELL - dh) / 2) + 8;

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / k));
      const sy = Math.min(h - 1, Math.floor(y / k));
      const s = (sy * w + sx) * 4;
      const a = px[s + 3] / 255;
      if (a <= 0.01) continue;
      sheet.blend(ox + x, oy + y, [px[s], px[s + 1], px[s + 2]], a);
    }
  }
});

writeFileSync(join(ROOT, 'letters-tracing-sheet.png'), encodePng(sheet.width, sheet.height, sheet.buf));
console.log(`Wrote letters-tracing-sheet.png ${sheet.width}x${sheet.height}`);
