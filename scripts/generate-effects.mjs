/**
 * Generates the visual effect sprites: projectiles, beams, shockwaves,
 * summons and impacts.
 *
 * Drawn procedurally in the game's pastel bubble style rather than sourced as
 * stock VFX, so a fireball sits next to a player's crayon drawing without
 * looking like it came from a different game.
 *
 *   node scripts/generate-effects.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Canvas, encodePng, roundedRect, ellipse, circle, ring, arc, star, capsule,
  flame, any, minus, outlineOf, darken, lighten, C, OUTLINE,
} from './lib/raster.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'effects');

/** Shorthand: outline pass then fill pass, with a gloss highlight. */
function blob(c, shape, grow, colour, gloss) {
  c.fill(grow, darken(colour, 0.6));
  c.fill(shape, colour);
  if (gloss) c.fill(gloss, C.white, 0.45);
}

// ------------------------------------------------------------------ projectiles

/** A teardrop flame with a smaller inner flame, licking to one side. */
function fire() {
  // Sized so the widest disc (the outline pass) clears the bottom edge:
  // baseY + radius must stay inside H, or the flame gets a flat cut base.
  const W = 190, H = 240, c = new Canvas(W, H);
  c.fill(flame(94, 170, 40, 66, 0.25), darken(C.coral, 0.6));
  c.fill(flame(94, 164, 48, 58, 0.25), C.coral);
  c.fill(flame(92, 158, 86, 32, 0.22), C.butter);
  c.fill(flame(91, 152, 116, 16, 0.18), lighten(C.butter, 0.55));
  c.fill(ellipse(72, 136, 11, 16), C.white, 0.42);
  return { W, H, c };
}

/** Radiant sun with a fat corona. */
function sun() {
  const W = 220, H = 220, c = new Canvas(W, H);
  c.fill(star(110, 110, 12, 66, 104), darken(C.butter, 0.6));
  c.fill(star(110, 110, 12, 60, 97), C.butter);
  c.fill(circle(110, 110, 62), darken(C.peach, 0.75));
  c.fill(circle(110, 110, 55), lighten(C.butter, 0.35));
  c.fill(ellipse(92, 92, 16, 20), C.white, 0.55);
  return { W, H, c };
}

function starShot() {
  const W = 160, H = 160, c = new Canvas(W, H);
  c.fill(star(80, 80, 5, 32, 74, -Math.PI / 2, 0.75), darken(C.butter, 0.6));
  c.fill(star(80, 80, 5, 28, 66, -Math.PI / 2, 0.75), C.butter);
  c.fill(ellipse(66, 62, 11, 14), C.white, 0.5);
  return { W, H, c };
}

function ice() {
  const W = 140, H = 190, c = new Canvas(W, H);
  const shard = any(ellipse(70, 100, 40, 84), ellipse(70, 60, 24, 40));
  blob(c, shard, any(ellipse(70, 100, 47, 91), ellipse(70, 60, 31, 47)), C.aqua, null);
  c.fill(ellipse(58, 78, 11, 30), C.white, 0.55);
  return { W, H, c };
}

function heart() {
  const W = 170, H = 160, c = new Canvas(W, H);
  const shape = any(circle(60, 62, 40), circle(110, 62, 40), ellipse(85, 96, 52, 46));
  const grow = any(circle(60, 62, 47), circle(110, 62, 47), ellipse(85, 96, 59, 53));
  blob(c, shape, grow, C.blossom, ellipse(56, 50, 14, 17));
  return { W, H, c };
}

function rock() {
  const W = 170, H = 160, c = new Canvas(W, H);
  const shape = any(ellipse(84, 88, 66, 56), ellipse(52, 66, 34, 30), ellipse(116, 70, 30, 28));
  const grow = any(ellipse(84, 88, 73, 63), ellipse(52, 66, 41, 37), ellipse(116, 70, 37, 35));
  blob(c, shape, grow, C.lavender, ellipse(60, 66, 16, 12));
  return { W, H, c };
}

// ----------------------------------------------------------------------- beams

/**
 * One tileable beam segment. Drawn as a horizontal capsule with a bright core
 * so the engine can stretch it between two points without it looking smeared.
 */
function beam() {
  const W = 256, H = 120, c = new Canvas(W, H);
  c.fill(capsule(16, 60, 240, 60, 50), darken(C.aqua, 0.55));
  c.fill(capsule(16, 60, 240, 60, 43), C.aqua);
  c.fill(capsule(24, 60, 232, 60, 24), lighten(C.aqua, 0.5));
  c.fill(capsule(24, 56, 232, 56, 9), C.white, 0.7);
  return { W, H, c };
}

/** The gathering orb at the heel of a beam. */
function charge() {
  const W = 200, H = 200, c = new Canvas(W, H);
  c.fill(star(100, 100, 8, 52, 92), darken(C.aqua, 0.5), 0.5);
  c.fill(circle(100, 100, 62), darken(C.aqua, 0.6));
  c.fill(circle(100, 100, 55), C.aqua);
  c.fill(circle(100, 100, 32), lighten(C.aqua, 0.6));
  c.fill(ellipse(84, 84, 15, 18), C.white, 0.6);
  return { W, H, c };
}

// ------------------------------------------------------------------ shockwaves

/** Concentric arcs — sound, shouting, singing. */
function soundwave() {
  const W = 240, H = 240, c = new Canvas(W, H);
  const a = -Math.PI / 2.6, b = Math.PI / 2.6;
  for (const [inner, outer, alpha] of [[52, 66, 1], [88, 102, 0.8], [124, 138, 0.55]]) {
    c.fill(arc(28, 120, inner + 6, outer + 6, a, b), darken(C.lavender, 0.6), alpha);
    c.fill(arc(28, 120, inner, outer, a, b), C.lavender, alpha);
  }
  return { W, H, c };
}

/** Expanding ring — impacts, stomps, generic shock. */
function shockring() {
  const W = 260, H = 260, c = new Canvas(W, H);
  c.fill(ring(130, 130, 88, 116), darken(C.white, 0.75), 0.85);
  c.fill(ring(130, 130, 94, 110), C.white, 0.9);
  return { W, H, c };
}

/**
 * A breaking wave.
 *
 * The curl is a solid crest with a hole punched through it — the hole is what
 * makes it read as a barrel rather than a blue lump. The outline pass uses a
 * slightly smaller hole so the dark edge rings the opening.
 */
function wave() {
  const W = 340, H = 220, c = new Canvas(W, H);

  const swell = ellipse(148, 184, 148, 42);
  const crest = minus(ellipse(238, 120, 80, 74), ellipse(254, 104, 36, 31));

  c.fill(any(
    ellipse(148, 184, 155, 49),
    minus(ellipse(238, 120, 87, 81), ellipse(254, 104, 29, 24)),
  ), darken(C.sky, 0.6));

  c.fill(any(swell, crest), C.sky);

  // Foam
  c.fill(ellipse(112, 170, 50, 11), C.white, 0.5);
  c.fill(ellipse(226, 60, 40, 12), C.white, 0.5);
  c.fill(ellipse(196, 140, 26, 9), C.white, 0.32);
  return { W, H, c };
}

// --------------------------------------------------------------------- summons

function drone() {
  const W = 240, H = 150, c = new Canvas(W, H);
  c.fill(outlineOf(84, 56, 72, 44, 20, OUTLINE), darken(C.ink, 1.2));
  c.fill(roundedRect(84, 56, 72, 44, 20), C.lavender);
  for (const x of [40, 200]) {
    c.fill(capsule(120, 74, x, 44, 8), darken(C.ink, 1.2));
    c.fill(capsule(120, 74, x, 44, 5), C.ink);
    c.fill(ellipse(x, 38, 44, 9), darken(C.aqua, 0.7), 0.75);
  }
  c.fill(ellipse(104, 70, 12, 9), C.white, 0.5);
  c.fill(circle(138, 82, 9), C.coral);
  return { W, H, c };
}

function meteor() {
  const W = 200, H = 260, c = new Canvas(W, H);
  for (const [dx, r, a] of [[0, 34, 0.5], [-16, 24, 0.35], [14, 20, 0.3]]) {
    c.fill(capsule(100 + dx, 60, 100 + dx, 8, r), C.coral, a);
  }
  const shape = any(ellipse(100, 172, 62, 58), ellipse(70, 148, 30, 26), ellipse(130, 152, 26, 24));
  const grow = any(ellipse(100, 172, 69, 65), ellipse(70, 148, 37, 33), ellipse(130, 152, 33, 31));
  blob(c, shape, grow, C.lavender, ellipse(78, 152, 14, 11));
  return { W, H, c };
}

function anvil() {
  const W = 240, H = 180, c = new Canvas(W, H);
  const shape = any(
    roundedRect(28, 34, 184, 52, 22),
    roundedRect(88, 78, 64, 46, 16),
    roundedRect(52, 116, 136, 36, 16),
  );
  c.fill(any(
    outlineOf(28, 34, 184, 52, 22, OUTLINE),
    outlineOf(88, 78, 64, 46, 16, OUTLINE),
    outlineOf(52, 116, 136, 36, 16, OUTLINE),
  ), darken(C.ink, 1.15));
  c.fill(shape, C.sky);
  c.fill(ellipse(76, 50, 30, 9), C.white, 0.45);
  return { W, H, c };
}

/** Because a piano falling on someone is always funny. */
function piano() {
  const W = 260, H = 200, c = new Canvas(W, H);
  c.fill(outlineOf(24, 40, 212, 116, 26, OUTLINE), darken(C.ink, 1.15));
  c.fill(roundedRect(24, 40, 212, 116, 26), C.ink);
  c.fill(roundedRect(40, 104, 180, 42, 12), C.white);
  for (let i = 0; i < 9; i++) {
    c.fill(roundedRect(52 + i * 19, 104, 4, 42, 2), darken(C.ink, 1.4), 0.55);
  }
  for (let i = 0; i < 8; i++) {
    if (i % 3 === 2) continue;
    c.fill(roundedRect(62 + i * 19, 104, 10, 24, 4), C.ink);
  }
  c.fill(ellipse(78, 62, 34, 10), C.white, 0.3);
  return { W, H, c };
}

// --------------------------------------------------------------------- impacts

/** The classic comic POW burst — few spikes, needle-sharp. */
function impact() {
  const W = 260, H = 260, c = new Canvas(W, H);
  c.fill(star(130, 130, 9, 40, 126, 0.2, 0.34), darken(C.butter, 0.6));
  c.fill(star(130, 130, 9, 33, 112, 0.2, 0.34), C.butter);
  c.fill(star(130, 130, 9, 17, 62, 0.2, 0.34), C.white, 0.9);
  return { W, H, c };
}

function sparkle() {
  const W = 120, H = 120, c = new Canvas(W, H);
  c.fill(star(60, 60, 4, 7, 56, 0, 0.3), darken(C.butter, 0.55));
  c.fill(star(60, 60, 4, 5, 48, 0, 0.3), lighten(C.butter, 0.5));
  return { W, H, c };
}

/** Dizzy spiral for stunned opponents. */
function dizzy() {
  const W = 140, H = 140, c = new Canvas(W, H);
  for (const [inner, outer, from, to] of [
    [18, 28, -2.6, 1.6], [40, 50, 0.4, 4.6], [62, 72, -1.4, 2.2],
  ]) {
    c.fill(arc(70, 70, inner + 5, outer + 5, from, to), darken(C.lavender, 0.6));
    c.fill(arc(70, 70, inner, outer, from, to), C.lavender);
  }
  return { W, H, c };
}

/** Speed lines, for dashes and teleports. */
function whoosh() {
  const W = 260, H = 160, c = new Canvas(W, H);
  for (const [y, len, a] of [[46, 200, 0.9], [80, 236, 1], [114, 176, 0.75]]) {
    c.fill(capsule(20, y, 20 + len, y, 13), darken(C.sky, 0.6), a * 0.8);
    c.fill(capsule(24, y, 16 + len, y, 8), C.sky, a);
  }
  return { W, H, c };
}

// ------------------------------------------------------------------------ main

mkdirSync(OUT, { recursive: true });

const effects = {
  fire, sun, star: starShot, ice, heart, rock,
  beam, charge,
  soundwave, shockring, wave,
  drone, meteor, anvil, piano,
  impact, sparkle, dizzy, whoosh,
};

const manifest = {};
for (const [name, make] of Object.entries(effects)) {
  const { W, H, c } = make();
  const png = encodePng(W, H, c.buf);
  writeFileSync(join(OUT, `${name}.png`), png);
  manifest[name] = { w: W, h: H };
  console.log(`  ${name.padEnd(11)} ${W}x${H}  ${String(png.length).padStart(6)} bytes`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nWrote ${Object.keys(effects).length} effect sprites to public/effects/`);
