/**
 * Generates placeholder character and weapon PNGs in the Jabbloo palette.
 *
 * These stand in until players draw their own. They are real RGBA PNGs with
 * transparent backgrounds, matching what the drawing tool will eventually
 * produce, so the sprite rig is exercised properly rather than against squares.
 *
 *   node scripts/generate-placeholders.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Canvas, encodePng, roundedRect, ellipse, outlineOf, darken, C, OUTLINE,
} from './lib/raster.mjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function character(fill) {
  const W = 256, H = 320, c = new Canvas(W, H);
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
  const W = 128, H = 256, c = new Canvas(W, H);

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
  const W = 144, H = 256, c = new Canvas(W, H);

  c.fill(outlineOf(18, 26, 108, 76, 28, OUTLINE), darken(headColour, 0.6));
  c.fill(outlineOf(58, 96, 26, 144, 13, OUTLINE), darken(C.peach, 0.6));

  c.fill(roundedRect(18, 26, 108, 76, 28), headColour);
  c.fill(ellipse(48, 50, 20, 11), C.white, 0.45);
  c.fill(roundedRect(58, 96, 26, 144, 13), C.peach);

  return { width: W, height: H, buf: c.buf };
}

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
