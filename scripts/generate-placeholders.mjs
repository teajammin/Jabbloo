/**
 * Generates placeholder character and weapon PNGs in the Jabbloo palette.
 *
 * These stand in until players draw their own. They are real RGBA PNGs with
 * transparent backgrounds, matching what the drawing tool will eventually
 * produce, so the sprite rig is exercised properly rather than against squares.
 *
 * Written with only Node built-ins (zlib) to avoid a native canvas dependency.
 *
 *   node scripts/generate-placeholders.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SS = 3; // supersampling factor for anti-aliasing

// ---------------------------------------------------------------- PNG encoding

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline gets a leading filter byte (0 = None).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- tiny raster

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.buf = Buffer.alloc(width * height * 4); // transparent
  }

  /** Alpha-composites a colour over one pixel. */
  blend(x, y, [r, g, b], alpha) {
    if (alpha <= 0) return;
    const i = (y * this.width + x) * 4;
    const dstA = this.buf[i + 3] / 255;
    const outA = alpha + dstA * (1 - alpha);
    if (outA <= 0) return;
    this.buf[i] = (r * alpha + this.buf[i] * dstA * (1 - alpha)) / outA;
    this.buf[i + 1] = (g * alpha + this.buf[i + 1] * dstA * (1 - alpha)) / outA;
    this.buf[i + 2] = (b * alpha + this.buf[i + 2] * dstA * (1 - alpha)) / outA;
    this.buf[i + 3] = outA * 255;
  }

  /**
   * Fills every pixel whose supersampled centre passes `inside`.
   * Coverage from the subsamples gives cheap anti-aliasing.
   */
  fill(inside, colour, alpha = 1) {
    const step = 1 / SS;
    const offset = step / 2;
    const samples = SS * SS;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            if (inside(x + sx * step + offset, y + sy * step + offset)) hits++;
          }
        }
        if (hits) this.blend(x, y, colour, (hits / samples) * alpha);
      }
    }
  }
}

// ------------------------------------------------------------------- geometry

const roundedRect = (x, y, w, h, r) => {
  const r2 = Math.min(r, w / 2, h / 2);
  return (px, py) => {
    if (px < x || px > x + w || py < y || py > y + h) return false;
    const cx = Math.min(Math.max(px, x + r2), x + w - r2);
    const cy = Math.min(Math.max(py, y + r2), y + h - r2);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r2 * r2;
  };
};

const ellipse = (cx, cy, rx, ry) => (px, py) =>
  ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;

/** Expands a rounded rect outward — used to paint outlines behind a shape. */
const outlineOf = (x, y, w, h, r, t) =>
  roundedRect(x - t, y - t, w + t * 2, h + t * 2, r + t);

// -------------------------------------------------------------------- palette

const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const darken = ([r, g, b], f = 0.72) => [r * f, g * f, b * f];

const C = {
  butter: hex(0xfbd87f),
  coral: hex(0xf98b8b),
  mint: hex(0xb7e9ae),
  sky: hex(0xa5cdf2),
  lavender: hex(0xc9b6ec),
  aqua: hex(0xa5e6e4),
  blossom: hex(0xf7a8c4),
  peach: hex(0xffc49b),
  ink: hex(0x4a4458),
  white: hex(0xffffff),
};

const OUTLINE = 7;

// -------------------------------------------------------------------- sprites

function character(fill) {
  const W = 256;
  const H = 320;
  const c = new Canvas(W, H);
  const [x, y, w, h, r] = [40, 64, 176, 244, 88];

  c.fill(outlineOf(x, y, w, h, r, OUTLINE), darken(fill, 0.6));
  c.fill(roundedRect(x, y, w, h, r), fill);
  // Glossy highlight, top-left — the bubble-letter look.
  c.fill(ellipse(96, 118, 34, 44), C.white, 0.5);
  // Face
  c.fill(ellipse(104, 186, 13, 15), C.ink);
  c.fill(ellipse(156, 186, 13, 15), C.ink);
  c.fill(ellipse(130, 224, 20, 12), darken(fill, 0.55));

  return { width: W, height: H, buf: c.buf };
}

function sword(bladeColour) {
  const W = 128;
  const H = 256;
  const c = new Canvas(W, H);

  c.fill(outlineOf(44, 22, 40, 152, 20, OUTLINE), darken(bladeColour, 0.6));
  c.fill(outlineOf(24, 168, 80, 22, 11, OUTLINE), darken(C.peach, 0.6));
  c.fill(outlineOf(52, 186, 24, 56, 12, OUTLINE), darken(C.coral, 0.6));

  c.fill(roundedRect(44, 22, 40, 152, 20), bladeColour);
  c.fill(ellipse(58, 70, 7, 34), C.white, 0.45);
  c.fill(roundedRect(24, 168, 80, 22, 11), C.peach);
  c.fill(roundedRect(52, 186, 24, 56, 12), C.coral);

  return { width: W, height: H, buf: c.buf };
}

function hammer(headColour) {
  const W = 144;
  const H = 256;
  const c = new Canvas(W, H);

  c.fill(outlineOf(18, 26, 108, 76, 28, OUTLINE), darken(headColour, 0.6));
  c.fill(outlineOf(58, 96, 26, 144, 13, OUTLINE), darken(C.peach, 0.6));

  c.fill(roundedRect(18, 26, 108, 76, 28), headColour);
  c.fill(ellipse(48, 50, 20, 11), C.white, 0.45);
  c.fill(roundedRect(58, 96, 26, 144, 13), C.peach);

  return { width: W, height: H, buf: c.buf };
}

// ----------------------------------------------------------------------- main

mkdirSync(OUT_DIR, { recursive: true });

const sprites = {
  'placeholder-character-a.png': character(C.coral),
  'placeholder-character-b.png': character(C.sky),
  'placeholder-weapon-sword.png': sword(C.butter),
  'placeholder-weapon-hammer.png': hammer(C.lavender),
};

for (const [name, sprite] of Object.entries(sprites)) {
  const png = encodePng(sprite.width, sprite.height, sprite.buf);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`  ${name}  ${sprite.width}x${sprite.height}  ${png.length} bytes`);
}

console.log(`\nWrote ${Object.keys(sprites).length} placeholder sprites to public/`);
