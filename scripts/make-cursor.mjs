/**
 * Draws the spear cursor the brief asks for, as a small PNG.
 *
 *   node scripts/make-cursor.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, encodePng, capsule, ellipse, any, darken, C } from './lib/raster.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT, { recursive: true });

// 40x40 keeps it crisp at the 32px CSS cursor cap on most displays.
const W = 40, H = 40;
const c = new Canvas(W, H);

// Shaft from the bottom-left to the tip at the top-right, head as a bubble
// triangle-ish blob. The hotspot is the tip: 38,3.
c.fill(capsule(7, 34, 31, 10, 4), darken(C.peach, 0.55));
c.fill(capsule(7, 34, 31, 10, 2.6), C.peach);

const head = any(ellipse(33, 8, 8, 8), ellipse(37, 4, 4, 4));
c.fill(any(ellipse(33, 8, 9.6, 9.6), ellipse(37, 4, 5.4, 5.4)), darken(C.sky, 0.55));
c.fill(head, C.sky);
c.fill(ellipse(31, 6, 2.6, 2.6), C.white, 0.6);

writeFileSync(join(OUT, 'cursor-spear.png'), encodePng(W, H, c.buf));
console.log('Wrote public/cursor-spear.png');
