/**
 * Draws the Jabbloo alphabet.
 *
 * Original artwork, so there is no licence to honour and glyphs regenerate at
 * any resolution.
 *
 * The reference letters are not stroked outlines — they are near-solid
 * inflated blobs. Counters are tiny pinholes rather than proportional holes,
 * notches are narrow slits cut into an otherwise solid mass, the outline is a
 * thin dark shade of the fill, and each letter carries bright white shines.
 * Building them as thin strokes gets the skeleton right and the character
 * completely wrong, so every glyph here is:
 *
 *     body    = union(fills) minus union(cuts)
 *     outline = union(fills grown by O) minus union(cuts shrunk by O)
 *
 * Every fill and cut is a function of an inflation delta, which is what lets
 * the same definition produce both passes and give notches and pinholes their
 * own dark rims.
 *
 *   node scripts/generate-letters.mjs [scale]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Canvas, encodePng, capsule, ellipse, roundedRect, any, all, minus, darken,
} from './lib/raster.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'letters');
const SCALE = Number(process.argv[2]) || 2;

const W = 270, H = 300;
const TOP = 70, BOT = 228, L = 55, R = 215;
const MX = (L + R) / 2, MY = (TOP + BOT) / 2;
const T = 42;         // stroke radius — fat enough that letters read as blobs
const O = 6;          // outline weight

/**
 * The VISUAL box.
 *
 * A stroked skeleton grows by half a stroke in every direction, so a path from
 * L to R actually occupies L-T to R+T. Shapes that are not stroked — the solid
 * blobs behind B, E, F, H and O — have to be authored against these bounds
 * instead, or they come out a stroke-width smaller than every letter beside
 * them.
 */
const VL = L - T, VR = R + T, VT = TOP - T, VB = BOT + T;
const VW = VR - VL, VH = VB - VT;

// ------------------------------------------------------------ shape factories
// Each returns (d) => shape, where d inflates or deflates it.

const P = (...pts) => (d) => strokePath(pts, T + d);
const Pt = (t, ...pts) => (d) => strokePath(pts, t + d);
const E = (cx, cy, rx, ry) => (d) => ellipse(cx, cy, rx + d, ry + d);
const Rect = (x, y, w, h, r) => (d) => roundedRect(x - d, y - d, w + 2 * d, h + 2 * d, r + d);
const Slit = (x1, y1, x2, y2, r) => (d) => capsule(x1, y1, x2, y2, r + d);
const Hole = (x, y, r) => (d) => ellipse(x, y, r + d, r + d);

/** Union / intersection of shape factories, so a glyph can be clipped. */
const Union = (...fs) => (d) => any(...fs.map((f) => f(d)));
const Both = (...fs) => (d) => all(...fs.map((f) => f(d)));

function strokePath(points, radius) {
  if (points.length === 1) return ellipse(points[0][0], points[0][1], radius, radius);
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push(capsule(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], radius));
  }
  return any(...segs);
}

/** Points along an ellipse arc, degrees, either direction. */
function arc(cx, cy, rx, ry, a0, a1, steps = 26) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

const g = (fills, cuts = [], shines = []) => ({ fills, cuts, shines });

// A pinhole counter plus the shine that usually sits beside it.
const HOLE_R = 11;

// ---------------------------------------------------------------------- glyphs

const BOWL = (cx, cy, rx, ry) => E(cx, cy, rx, ry);

const LETTERS = {
  A: g(
    [P([L + 6, BOT], [MX - 4, TOP], [R - 6, BOT]), Pt(34, [L + 30, 176], [R - 30, 176])],
    [Hole(MX - 2, 124, HOLE_R)],
    [[62, 120, 12, 44, -0.2], [MX + 30, 186, 10, 26, 0.1]],
  ),
  // Flat top and bottom with the curvature on the right.
  //
  // The lobes are drawn taller than the letter and then clipped to a
  // straight-edged box: letting them dome instead gives a rounded blob, and
  // flattening them by shrinking the ellipses loses the bulge that makes the
  // waist read. The pinch is the gap where the two lobes' right edges recede.
  B: g(
    [Both(
      Union(
        Rect(VL, VT, 116, VH, 44),
        BOWL(VL + 128, VT + 62, 112, 86),
        BOWL(VL + 132, VB - 64, 112, 88),
      ),
      Rect(VL, VT, VW, VH, 46),
    )],
    [Hole(VL + 166, VT + 66, HOLE_R), Hole(VL + 170, VB - 68, HOLE_R)],
    [[VL + 38, VT + 44, 14, 34, 0.1], [VL + 52, VB - 42, 12, 26, 0.15]],
  ),
  C: g([P(...arc(MX, MY, 78, 76, 54, 306))], [], [[MX - 34, TOP + 34, 13, 30, -0.7]]),
  D: g(
    [P([L + 8, TOP], [L + 8, BOT]), BOWL(MX + 4, MY, VW / 2 - 12, VH / 2)],
    [Hole(MX + 24, MY, HOLE_R)],
    [[VL + 34, VT + 44, 12, 34, 0], [MX + 66, MY + 56, 12, 26, -0.6]],
  ),
  E: g(
    [Rect(VL, VT, VW, VH, 66)],
    [Slit(VR + 40, VT + 73, VL + 100, VT + 73, 15),
     Slit(VR + 40, VB - 73, VL + 100, VB - 73, 15)],
    [[VL + 34, VT + 42, 12, 30, 0], [VL + 34, VB - 44, 11, 24, 0]],
  ),
  F: g(
    [Rect(VL, VT, VW, VH, 66)],
    [Slit(VR + 40, VT + 78, VL + 100, VT + 78, 15),
     Rect(VL + 100, MY + 28, VW, VH, 34)],
    [[VL + 34, VT + 42, 12, 30, 0]],
  ),
  G: g(
    [P(...arc(MX, MY, 78, 76, 54, 306)), Pt(40, [MX + 4, MY + 24], [R - 8, MY + 24])],
    [],
    [[MX - 34, TOP + 34, 13, 30, -0.7]],
  ),
  H: g(
    [Rect(VL, VT, VW, VH, 66)],
    [Slit(MX, VT - 60, MX, MY - 72, 42), Slit(MX, MY + 72, MX, VB + 60, 42)],
    [[VL + 34, VT + 42, 12, 32, 0], [VR - 34, VB - 46, 11, 26, 0]],
  ),
  I: g([P([MX, TOP], [MX, BOT])], [], [[MX - 14, TOP + 28, 11, 34, 0]]),
  J: g(
    [P([R - 30, TOP], [R - 30, 148], ...arc(R - 30 - 52, 148, 52, 48, 0, 176))],
    [],
    [[R - 44, TOP + 28, 11, 30, 0]],
  ),
  K: g(
    [P([L, TOP], [L, BOT]), P([L + 10, MY], [R, TOP]), P([L + 10, MY], [R, BOT])],
    [],
    [[L + 16, TOP + 28, 11, 30, 0], [R - 40, TOP + 42, 10, 22, 0.7]],
  ),
  L: g(
    [P([L, TOP], [L, BOT]), P([L, BOT], [R, BOT])],
    [],
    [[L + 16, TOP + 30, 11, 34, 0], [MX + 30, BOT - 18, 12, 22, -0.5]],
  ),
  M: g(
    [P([L, BOT], [L, TOP], [MX, MY + 24], [R, TOP], [R, BOT])],
    [],
    [[L + 16, TOP + 30, 11, 30, 0], [R - 16, TOP + 30, 10, 26, 0]],
  ),
  N: g(
    [P([L, BOT], [L, TOP], [R, BOT], [R, TOP])],
    [],
    [[L + 16, TOP + 30, 11, 30, 0], [R - 16, TOP + 34, 10, 26, 0]],
  ),
  O: g(
    [BOWL(MX, MY, VW / 2, VH / 2)],
    [Hole(MX, MY, HOLE_R)],
    [[MX - 66, VT + 46, 15, 36, -0.5], [MX + 70, VB - 56, 13, 28, -0.5]],
  ),
  P: g(
    [P([L, TOP], [L, BOT]), BOWL(MX + 10, VT + 78, VW / 2 - 16, 78)],
    [Hole(MX + 26, VT + 78, HOLE_R)],
    [[VL + 32, VT + 44, 12, 32, 0], [MX + 60, VT + 132, 11, 22, -0.6]],
  ),
  Q: g(
    [BOWL(MX, MY, VW / 2 - 6, VH / 2 - 4), Pt(28, [MX + 60, MY + 72], [VR - 10, VB + 4])],
    [Hole(MX, MY, HOLE_R)],
    [[MX - 62, VT + 48, 15, 34, -0.5]],
  ),
  R: g(
    [P([L, TOP], [L, BOT]), BOWL(MX + 6, VT + 74, VW / 2 - 24, 74), Pt(38, [L + 20, MY + 12], [R, BOT])],
    [Hole(MX + 20, VT + 74, HOLE_R)],
    [[VL + 32, VT + 44, 12, 30, 0]],
  ),
  S: g(
    [Pt(33, [192, 100], [144, 72], [88, 84], [74, 118], [108, 142],
        [162, 160], [184, 188], [168, 216], [120, 230], [70, 214])],
    [],
    [[114, 96, 12, 24, 0.5], [138, 198, 11, 22, 0.4]],
  ),
  T: g(
    [P([L, TOP], [R, TOP]), P([MX, TOP], [MX, BOT])],
    [],
    [[L + 30, TOP - 12, 11, 22, 1.4], [MX - 14, MY, 11, 32, 0]],
  ),
  U: g(
    [P([L, TOP], [L, 144], ...arc(MX, 144, MX - L, 62, 180, 0), [R, 144], [R, TOP])],
    [],
    [[L + 16, TOP + 30, 11, 32, 0], [R - 16, TOP + 34, 10, 26, 0]],
  ),
  V: g([P([L + 4, TOP], [MX, BOT], [R - 4, TOP])], [], [[L + 20, TOP + 30, 11, 30, 0.25]]),
  W: g(
    [P([L, TOP], [L + 36, BOT], [MX, MY + 6], [R - 36, BOT], [R, TOP])],
    [],
    [[L + 14, TOP + 30, 11, 28, 0.2], [R - 14, TOP + 30, 10, 24, -0.2]],
  ),
  X: g(
    [P([L + 4, TOP], [R - 4, BOT]), P([R - 4, TOP], [L + 4, BOT])],
    [],
    [[L + 24, TOP + 26, 11, 24, 0.7], [R - 24, TOP + 26, 10, 22, -0.7]],
  ),
  Y: g(
    [P([L + 4, TOP], [MX, MY + 12]), P([R - 4, TOP], [MX, MY + 12]), P([MX, MY + 12], [MX, BOT])],
    [],
    [[L + 20, TOP + 28, 11, 26, 0.3]],
  ),
  Z: g(
    [P([L, TOP], [R, TOP], [L, BOT], [R, BOT])],
    [],
    [[L + 30, TOP - 12, 11, 22, 1.4], [MX + 20, BOT + 12, 11, 22, 1.4]],
  ),

  excl: g([P([MX, TOP], [MX, 152]), P([MX, BOT - 6])], [], [[MX - 12, TOP + 26, 10, 26, 0]]),
  query: g(
    [Pt(36, ...arc(MX, TOP + 56, 56, 52, 184, 398), [MX + 10, 146], [MX, 162]), P([MX, BOT - 6])],
    [],
    [[MX - 26, TOP + 22, 10, 22, 0.6]],
  ),
  dot: g([P([MX, BOT - 6])], [], [[MX - 10, BOT - 22, 8, 14, 0]]),
  comma: g([P([MX, BOT - 26]), Pt(26, [MX + 6, BOT - 18], [MX - 16, BOT + 28])], [], []),
};

/**
 * Per-letter colours, following the reference sheet rather than a repeating
 * cycle — the original alphabet's colours are deliberately scattered.
 */
const COLOURS = {
  A: 0xfbd268, B: 0xf79bb8, C: 0x8fb8f0, D: 0xa8de9b, E: 0xf4796f, F: 0xcbb2ed,
  G: 0xa9e5c8, H: 0x8fb8f0, I: 0xf4796f, J: 0xa9d8f0, K: 0xfbd268, L: 0xcbb2ed,
  M: 0xf79bb8, N: 0xa8de9b, O: 0xfbd268, P: 0xf4796f, Q: 0xa8de9b, R: 0x7fcfc4,
  S: 0xa9d8f0, T: 0xf4796f, U: 0x8fb8f0, V: 0xcbb2ed, W: 0xf79bb8, X: 0xa8e4ec,
  Y: 0xa8de9b, Z: 0xfbd268, excl: 0xf79bb8, query: 0xa9d8f0, dot: 0xcbb2ed,
  comma: 0x7fcfc4,
};

const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

// ------------------------------------------------------------------------ draw

function render({ fills, cuts, shines }, colour, scale) {
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const c = new Canvas(w, h);
  const s = (shape) => (px, py) => shape(px / scale, py / scale);

  const body = cuts.length
    ? minus(any(...fills.map((f) => f(0))), any(...cuts.map((k) => k(0))))
    : any(...fills.map((f) => f(0)));

  // Cuts shrink for the outline pass, so notches and pinholes get a dark rim.
  const outline = cuts.length
    ? minus(any(...fills.map((f) => f(O))), any(...cuts.map((k) => k(-O))))
    : any(...fills.map((f) => f(O)));

  c.fill(s(outline), darken(rgb(colour), 0.45));
  c.fill(s(body), rgb(colour));

  // Shines: bright, slightly tilted streaks clipped to the letter.
  for (const [x, y, rx, ry, tilt] of shines) {
    const dx = Math.sin(tilt) * ry * 0.8, dy = Math.cos(tilt) * ry * 0.8;
    c.fill(s(all(body, capsule(x - dx, y - dy, x + dx, y + dy, rx))), [255, 255, 255], 0.92);
  }

  return { w, h, buf: c.buf };
}

/** Trim transparent columns; keep full height so baselines align everywhere. */
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
  const x0 = Math.max(0, left - pad), x1 = Math.min(w - 1, right + pad);
  const nw = x1 - x0 + 1;
  const out = Buffer.alloc(nw * h * 4);
  for (let y = 0; y < h; y++) {
    buf.copy(out, y * nw * 4, (y * w + x0) * 4, (y * w + x1 + 1) * 4);
  }
  return { buf: out, w: nw, h };
}

mkdirSync(OUT, { recursive: true });

const manifest = {};
for (const [name, def] of Object.entries(LETTERS)) {
  const raw = render(def, COLOURS[name] ?? 0xfbd268, SCALE);
  const { buf, w, h } = cropWidth(raw.buf, raw.w, raw.h);
  writeFileSync(join(OUT, `${name}.png`), encodePng(w, h, buf));
  manifest[name] = { w, h };
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${Object.keys(LETTERS).length} glyphs at ${W * SCALE}x${H * SCALE}`);

// ------------------------------------------------------------- contact sheet

const COLS = 8;
const rows = Math.ceil(Object.keys(LETTERS).length / COLS);
const cell = 130;
const sheet = new Canvas(COLS * cell, rows * cell);
let i = 0;
for (const [name, def] of Object.entries(LETTERS)) {
  const col = i % COLS, row = Math.floor(i / COLS);
  const k = cell / H;
  const ox = col * cell + (cell - W * k) / 2, oy = row * cell;
  const colour = rgb(COLOURS[name] ?? 0xfbd268);
  const body = def.cuts.length
    ? minus(any(...def.fills.map((f) => f(0))), any(...def.cuts.map((c2) => c2(0))))
    : any(...def.fills.map((f) => f(0)));
  const outline = def.cuts.length
    ? minus(any(...def.fills.map((f) => f(O))), any(...def.cuts.map((c2) => c2(-O))))
    : any(...def.fills.map((f) => f(O)));
  sheet.fill((px, py) => outline((px - ox) / k, (py - oy) / k), darken(colour, 0.45));
  sheet.fill((px, py) => body((px - ox) / k, (py - oy) / k), colour);
  for (const [x, y, rx, ry, tilt] of def.shines) {
    const dx = Math.sin(tilt) * ry * 0.8, dy = Math.cos(tilt) * ry * 0.8;
    const sh = all(body, capsule(x - dx, y - dy, x + dx, y + dy, rx));
    sheet.fill((px, py) => sh((px - ox) / k, (py - oy) / k), [255, 255, 255], 0.92);
  }
  i++;
}
writeFileSync(join(OUT, '..', '..', 'letters-sheet.png'), encodePng(sheet.width, sheet.height, sheet.buf));
console.log('Wrote letters-sheet.png (repo root) for review');
