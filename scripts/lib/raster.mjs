/**
 * Minimal software rasteriser and PNG encoder.
 *
 * Shared by the placeholder and effect generators. Uses only Node built-ins —
 * no native canvas dependency, so asset generation works on any machine that
 * can run the project.
 */

import { deflateSync } from 'node:zlib';

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

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

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

export class Canvas {
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

  /** Draws a shape with a darker outline behind it, the house bubble style. */
  bubble(shape, outlineShape, colour, outlineColour) {
    this.fill(outlineShape, outlineColour ?? darken(colour, 0.6));
    this.fill(shape, colour);
  }
}

// ------------------------------------------------------------------- geometry

export const roundedRect = (x, y, w, h, r) => {
  const r2 = Math.min(r, w / 2, h / 2);
  return (px, py) => {
    if (px < x || px > x + w || py < y || py > y + h) return false;
    const cx = Math.min(Math.max(px, x + r2), x + w - r2);
    const cy = Math.min(Math.max(py, y + r2), y + h - r2);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r2 * r2;
  };
};

export const ellipse = (cx, cy, rx, ry) => (px, py) =>
  ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;

export const circle = (cx, cy, r) => ellipse(cx, cy, r, r);

/** Ring between two radii — soundwaves, shockwaves, halos. */
export const ring = (cx, cy, inner, outer) => (px, py) => {
  const d2 = (px - cx) ** 2 + (py - cy) ** 2;
  return d2 <= outer * outer && d2 >= inner * inner;
};

/** An arc of a ring, angles in radians. Used for sound arcs and swipe trails. */
export const arc = (cx, cy, inner, outer, from, to) => (px, py) => {
  const d2 = (px - cx) ** 2 + (py - cy) ** 2;
  if (d2 > outer * outer || d2 < inner * inner) return false;
  let a = Math.atan2(py - cy, px - cx);
  if (a < 0) a += Math.PI * 2;
  let f = from, t = to;
  if (f < 0) f += Math.PI * 2;
  if (t < 0) t += Math.PI * 2;
  return f <= t ? a >= f && a <= t : a >= f || a <= t;
};

/**
 * Star / burst polygon — impacts, sparkles, suns.
 *
 * `sharpness` shapes the spike profile: 1 gives straight-sided points, below 1
 * gives thin needle spikes (comic impact bursts), above 1 gives fat petals.
 */
export const star = (cx, cy, points, inner, outer, rotation = 0, sharpness = 1) => (px, py) => {
  const dx = px - cx, dy = py - cy;
  const d = Math.hypot(dx, dy);
  if (d > outer) return false;
  if (d <= inner) return true;
  const a = Math.atan2(dy, dx) - rotation;
  const seg = (Math.PI * 2) / points;
  // Distance from the nearest spike axis, normalised across half a segment.
  const t = Math.abs(((a % seg) + seg + seg / 2) % seg - seg / 2) / (seg / 2);
  return d <= outer - (outer - inner) * Math.pow(t, sharpness);
};

/**
 * Teardrop flame.
 *
 * Built by sweeping a shrinking circle along a curved spine rather than by
 * tapering straight sides — overlapping circles guarantee smooth, rounded
 * edges, where a width function produces a triangle with hard corners.
 * `lean` bends the spine sideways so the flame looks blown by the wind.
 */
export const flame = (cx, baseY, tipY, radius, lean = 0) => {
  const steps = 28;
  const height = baseY - tipY;
  const discs = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;                       // 0 at base, 1 at tip
    const r = radius * Math.pow(1 - t, 0.62);   // lower exponent = fuller body
    if (r < 0.4) continue;
    discs.push([cx + lean * radius * Math.pow(t, 1.7), baseY - height * t, r]);
  }
  return (px, py) => discs.some(([x, y, r]) => (px - x) ** 2 + (py - y) ** 2 <= r * r);
};

/** Capsule between two points — beams, limbs, trails. */
export const capsule = (x1, y1, x2, y2, r) => (px, py) => {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

/** Union / intersection / subtraction, for composing the above. */
export const any = (...shapes) => (px, py) => shapes.some((s) => s(px, py));
export const all = (...shapes) => (px, py) => shapes.every((s) => s(px, py));
export const not = (shape) => (px, py) => !shape(px, py);
export const minus = (a, b) => (px, py) => a(px, py) && !b(px, py);

/** Expands a rounded rect outward — outlines behind a shape. */
export const outlineOf = (x, y, w, h, r, t) =>
  roundedRect(x - t, y - t, w + t * 2, h + t * 2, r + t);

// -------------------------------------------------------------------- palette

export const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
export const darken = ([r, g, b], f = 0.72) => [r * f, g * f, b * f];
export const lighten = ([r, g, b], f = 0.3) =>
  [r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f];

/** The Jabbloo palette, mirroring src/engine/theme.ts. */
export const C = {
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

export const OUTLINE = 7;
