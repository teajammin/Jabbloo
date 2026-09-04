/**
 * Draws the Jabbloo alphabet.
 *
 * Original artwork, so there is no licence to honour and glyphs can be
 * regenerated at any resolution. The previous set was extracted from a 642x350
 * bitmap in the design brief and was soft above about 90px.
 *
 * Every letter is one or more stroked paths: a polyline rendered as a chain of
 * overlapping round-capped capsules. That gives uniform, fully rounded strokes
 * with no corner joins to fix, and counters — the holes in O, B, P — fall out
 * for free wherever a path closes on itself.
 *
 *   node scripts/generate-letters.mjs [scale]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Canvas, encodePng, capsule, ellipse, any, all, darken, lighten, C,
} from './lib/raster.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'letters');
const SCALE = Number(process.argv[2]) || 2;

// Design box. Letters are authored here, then scaled on output.
const W = 220, H = 270;
const TOP = 56, BOT = 214, L = 42, R = 178;
const MX = 110, MY = (TOP + BOT) / 2;
const T = 27;          // stroke radius; 54px wide strokes read as "bubble"
const OUTLINE = 9;

// ------------------------------------------------------------------- geometry

/** Points along an ellipse arc, in degrees, either direction. */
function arcPts(cx, cy, rx, ry, a0, a1, steps = 22) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** A polyline stroked with round caps. */
function stroke(points, radius) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    segments.push(capsule(x1, y1, x2, y2, radius));
  }
  // A single point is a dot.
  if (segments.length === 0 && points.length === 1) {
    return ellipse(points[0][0], points[0][1], radius, radius);
  }
  return any(...segments);
}

const glyph = (...paths) => paths;

// --------------------------------------------------------------------- shapes

const CIRCLE = arcPts(MX, MY, 70, 79, 0, 360, 40);

const LETTERS = {
  A: glyph([[L, BOT], [MX, TOP], [R, BOT]], [[L + 28, 180], [R - 28, 180]]),
  B: glyph(
    [[L, TOP], [L, BOT]],
    [[L, TOP], ...arcPts(102, 100, 60, 44, -90, 90), [L, MY]],
    [[L, MY], ...arcPts(102, 170, 64, 46, -90, 90), [L, BOT]],
  ),
  C: glyph(arcPts(MX, MY, 70, 79, 52, 308)),
  D: glyph([[L, TOP], [L, BOT]], [[L, TOP], ...arcPts(L + 6, MY, 76, 79, -90, 90), [L, BOT]]),
  E: glyph(
    [[L, TOP], [L, BOT]], [[L, TOP], [R, TOP]], [[L, MY], [R - 20, MY]], [[L, BOT], [R, BOT]],
  ),
  F: glyph([[L, TOP], [L, BOT]], [[L, TOP], [R, TOP]], [[L, MY], [R - 20, MY]]),
  G: glyph(arcPts(MX, MY, 70, 79, 52, 308), [[MX - 4, MY + 16], [R - 4, MY + 16]]),
  H: glyph([[L, TOP], [L, BOT]], [[R, TOP], [R, BOT]], [[L, MY], [R, MY]]),
  I: glyph([[MX, TOP], [MX, BOT]]),
  J: glyph([[R - 16, TOP], [R - 16, 164]], [...arcPts(R - 16 - 52, 164, 52, 44, 0, 180)]),
  K: glyph([[L, TOP], [L, BOT]], [[L + 8, MY + 6], [R, TOP]], [[L + 8, MY - 6], [R, BOT]]),
  L: glyph([[L, TOP], [L, BOT]], [[L, BOT], [R, BOT]]),
  M: glyph([[L, BOT], [L, TOP], [MX, MY + 26], [R, TOP], [R, BOT]]),
  N: glyph([[L, BOT], [L, TOP], [R, BOT], [R, TOP]]),
  O: glyph(CIRCLE),
  P: glyph([[L, TOP], [L, BOT]], [[L, TOP], ...arcPts(102, 112, 62, 52, -90, 90), [L, MY + 20]]),
  Q: glyph(CIRCLE, [[MX + 36, MY + 45], [R + 6, BOT + 16]]),
  R: glyph(
    [[L, TOP], [L, BOT]],
    [[L, TOP], ...arcPts(100, 106, 60, 50, -90, 90), [L, MY + 12]],
    [[L + 10, MY + 12], [R, BOT]],
  ),
  // Drawn as one continuous ribbon rather than two arcs. At this stroke weight
  // any pair of bowls round enough to read as an S closes into an 8 — the waist
  // lands inside both openings. A single open path cannot close on itself.
  S: glyph([
    [160, 92], [126, 68], [84, 74], [66, 100], [80, 124],
    [122, 136], [152, 156], [158, 182], [132, 206], [88, 208], [60, 190],
  ]),
  T: glyph([[L, TOP], [R, TOP]], [[MX, TOP], [MX, BOT]]),
  U: glyph([[L, TOP], [L, 152], ...arcPts(MX, 152, 68, 60, 180, 0), [R, 152], [R, TOP]]),
  V: glyph([[L, TOP], [MX, BOT], [R, TOP]]),
  W: glyph([[L, TOP], [L + 32, BOT], [MX, 132], [R - 32, BOT], [R, TOP]]),
  X: glyph([[L, TOP], [R, BOT]], [[R, TOP], [L, BOT]]),
  Y: glyph([[L, TOP], [MX, MY + 14]], [[R, TOP], [MX, MY + 14]], [[MX, MY + 14], [MX, BOT]]),
  Z: glyph([[L, TOP], [R, TOP], [L, BOT], [R, BOT]]),

  excl: glyph([[MX, TOP], [MX, 156]], [[MX, BOT - 4]]),
  query: glyph(
    [...arcPts(MX, TOP + 48, 48, 44, 185, 398), [MX + 6, 146], [MX, 162]],
    [[MX, BOT - 4]],
  ),
  dot: glyph([[MX, BOT - 4]]),
  comma: glyph([[MX, BOT - 20]], [[MX + 4, BOT - 12], [MX - 14, BOT + 26]]),
};

/** One pastel per letter, cycling — the reference alphabet is multicoloured. */
const PALETTE = [C.butter, C.coral, C.mint, C.sky, C.lavender, C.aqua, C.blossom, C.peach];

// ------------------------------------------------------------------------ draw

function render(paths, colour, scale) {
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const c = new Canvas(w, h);

  // Scale every shape by rendering into a scaled coordinate test.
  const s = (shape) => (px, py) => shape(px / scale, py / scale);

  const body = any(...paths.map((p) => stroke(p, T)));
  const outline = any(...paths.map((p) => stroke(p, T + OUTLINE)));

  c.fill(s(outline), darken(colour, 0.58));
  c.fill(s(body), colour);

  // Gloss, clipped to the letter so it only lights the stroke.
  c.fill(s(all(body, ellipse(66, 104, 13, 24))), C.white, 0.5);
  c.fill(s(all(body, ellipse(150, 96, 9, 15))), lighten(colour, 0.5), 0.55);

  return { w, h, buf: c.buf };
}

/**
 * Trims transparent columns from both sides.
 *
 * Height is left alone on purpose: every glyph keeping the full design height
 * means baselines line up automatically wherever they are laid out, with no
 * per-glyph offset table. Only the width needs to be tight, or an I would carry
 * as much side padding as a W.
 */
function cropWidth(buf, w, h) {
  let left = w, right = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right < left) return { buf, w, h };

  const pad = Math.round(4 * SCALE);
  const x0 = Math.max(0, left - pad);
  const x1 = Math.min(w - 1, right + pad);
  const nw = x1 - x0 + 1;

  const out = Buffer.alloc(nw * h * 4);
  for (let y = 0; y < h; y++) {
    buf.copy(out, y * nw * 4, (y * w + x0) * 4, (y * w + x1 + 1) * 4);
  }
  return { buf: out, w: nw, h };
}

mkdirSync(OUT, { recursive: true });

const manifest = {};
let index = 0;
for (const [name, paths] of Object.entries(LETTERS)) {
  const colour = PALETTE[index++ % PALETTE.length];
  const raw = render(paths, colour, SCALE);
  const { buf, w, h } = cropWidth(raw.buf, raw.w, raw.h);
  writeFileSync(join(OUT, `${name}.png`), encodePng(w, h, buf));
  manifest[name] = { w, h };
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${Object.keys(LETTERS).length} glyphs at ${W * SCALE}x${H * SCALE} to public/letters/`);

// ------------------------------------------------------------- contact sheet

const COLS = 8;
const rows = Math.ceil(Object.keys(LETTERS).length / COLS);
const cell = 120;
const sheet = new Canvas(COLS * cell, rows * cell);
index = 0;
for (const [, paths] of Object.entries(LETTERS)) {
  const col = index % COLS, row = Math.floor(index / COLS);
  const colour = PALETTE[index % PALETTE.length];
  const k = cell / H;
  const ox = col * cell + (cell - W * k) / 2, oy = row * cell;
  const body = any(...paths.map((p) => stroke(p, T)));
  const outline = any(...paths.map((p) => stroke(p, T + OUTLINE)));
  sheet.fill((px, py) => outline((px - ox) / k, (py - oy) / k), darken(colour, 0.58));
  sheet.fill((px, py) => body((px - ox) / k, (py - oy) / k), colour);
  index++;
}
// Review artifact, not a game asset — kept out of public/ so it never ships.
writeFileSync(join(OUT, '..', '..', 'letters-sheet.png'), encodePng(sheet.width, sheet.height, sheet.buf));
console.log('Wrote letters-sheet.png (repo root) for review');
