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

/**
 * Expanding ring — impacts, stomps, generic shock.
 *
 * Drawn with the game's ink outline rather than as plain white. A white ring
 * on a pastel battleground does not read as a shockwave; it reads as a stray
 * white circle appearing for no reason, which is exactly how it was reported.
 * The outline is what gives it a shape at any size, on any ground.
 */
function shockring() {
  const W = 260, H = 260, c = new Canvas(W, H);
  c.fill(ring(130, 130, 84, 120), C.ink, 0.9);
  c.fill(ring(130, 130, 90, 114), C.sky, 0.95);
  c.fill(ring(130, 130, 97, 107), C.white, 0.95);
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


/* -------------------------------------------------------------- projectiles */

/** A bullet: a capsule with a bright nose and a short trail. */
function bullet() {
  const W = 150, H = 80, c = new Canvas(W, H);
  c.fill(capsule(46, 40, 116, 40, 22), darken(C.ink, 0.9));
  c.fill(capsule(50, 40, 112, 40, 17), C.butter);
  c.fill(circle(112, 40, 17), lighten(C.butter, 0.55));
  c.fill(capsule(10, 40, 40, 40, 7), C.white, 0.5);
  return { W, H, c };
}

/** An arrow: shaft, head, flights. */
function arrow() {
  const W = 200, H = 84, c = new Canvas(W, H);
  const head = any(
    (px, py) => px > 140 && px < 192 && Math.abs(py - 42) < (192 - px) * 0.62,
  );
  c.fill(capsule(22, 42, 156, 42, 11), darken(C.peach, 0.6));
  c.fill(capsule(26, 42, 152, 42, 7), C.peach);
  c.fill(head, darken(C.sky, 0.6));
  c.fill((px, py) => head(px + 5, py) && head(px - 5, py), C.sky);
  for (const dy of [-1, 1]) {
    c.fill((px, py) => px > 14 && px < 58
      && Math.abs(py - (42 + dy * 16)) < 9 - Math.abs(px - 36) * 0.18, C.coral);
  }
  return { W, H, c };
}

/** A thrown stone or pellet, smaller and rounder than the rock. */
function pebble() {
  const W = 90, H = 90, c = new Canvas(W, H);
  blob(c, ellipse(45, 46, 30, 27), ellipse(45, 46, 37, 34), C.lavender, ellipse(35, 36, 9, 7));
  return { W, H, c };
}

/** A dart of water. */
function splash() {
  const W = 180, H = 150, c = new Canvas(W, H);
  c.fill(any(ellipse(90, 96, 68, 44), ellipse(62, 62, 26, 30), ellipse(122, 58, 22, 26)),
    darken(C.sky, 0.55));
  c.fill(any(ellipse(90, 96, 60, 37), ellipse(62, 62, 20, 24), ellipse(122, 58, 16, 20)), C.sky);
  c.fill(ellipse(70, 82, 16, 10), C.white, 0.6);
  return { W, H, c };
}

/** A bolt of lightning. */
function bolt() {
  const W = 130, H = 240, c = new Canvas(W, H);
  const zig = (px, py) => {
    const t = py / H;
    const spine = t < 0.5 ? 84 - t * 90 : 30 + (t - 0.5) * 120;
    return Math.abs(px - spine) < 24 - Math.abs(t - 0.5) * 16;
  };
  c.fill(zig, darken(C.butter, 0.55));
  c.fill((px, py) => zig(px + 7, py) && zig(px - 7, py), C.butter);
  c.fill((px, py) => zig(px + 14, py) && zig(px - 14, py), C.white, 0.85);
  return { W, H, c };
}

/** A gust of wind: three tapering streaks with curled ends. */
function wind() {
  const W = 280, H = 170, c = new Canvas(W, H);
  for (const [y, len, curl] of [[52, 240, 1], [92, 200, -1], [130, 160, 1]]) {
    c.fill(capsule(20, y, len, y, 11), darken(C.aqua, 0.5), 0.9);
    c.fill(capsule(24, y, len - 4, y, 7), C.aqua);
    c.fill(ring(len, y + curl * 18, 12, 19), C.aqua, 0.95);
  }
  return { W, H, c };
}

/** A puff of dust. */
function dust() {
  const W = 220, H = 130, c = new Canvas(W, H);
  const puff = any(ellipse(70, 80, 46, 34), ellipse(130, 66, 52, 40), ellipse(180, 86, 34, 26));
  c.fill(puff, darken(C.peach, 0.75), 0.55);
  c.fill((px, py) => puff(px + 6, py) && puff(px, py + 6), lighten(C.peach, 0.35), 0.85);
  return { W, H, c };
}

/** Smoke, greyer and taller than dust. */
function smoke() {
  const W = 170, H = 220, c = new Canvas(W, H);
  const column = any(
    ellipse(85, 180, 52, 34), ellipse(78, 128, 44, 36),
    ellipse(92, 82, 36, 30), ellipse(84, 44, 26, 22),
  );
  c.fill(column, darken(C.white, 0.45), 0.5);
  c.fill((px, py) => column(px + 7, py + 7), darken(C.white, 0.2), 0.6);
  return { W, H, c };
}

/** A stink cloud — green, lumpy, with three little wisps. */
function stink() {
  const W = 210, H = 170, c = new Canvas(W, H);
  const cloud = any(
    ellipse(100, 108, 62, 44), ellipse(62, 84, 34, 30),
    ellipse(140, 82, 38, 32), ellipse(106, 66, 30, 26),
  );
  c.fill(cloud, darken(C.mint, 0.55));
  c.fill((px, py) => cloud(px + 6, py) && cloud(px - 6, py), C.mint, 0.92);
  for (const [x, y, r] of [[44, 42, 9], [160, 40, 8], [104, 26, 7]]) {
    c.fill(circle(x, y, r), C.mint, 0.7);
  }
  return { W, H, c };
}

/** The unspeakable. A rounded coil with a shine, because this is a party game. */
function poop() {
  const W = 170, H = 160, c = new Canvas(W, H);
  const brown = [122, 84, 58];
  const coil = any(
    ellipse(85, 126, 64, 28), ellipse(85, 92, 46, 24), ellipse(85, 62, 30, 20),
  );
  c.fill(coil, darken(brown, 0.6));
  c.fill((px, py) => coil(px + 6, py) && coil(px - 6, py) && coil(px, py + 6), brown);
  c.fill(ellipse(66, 56, 9, 6), C.white, 0.45);
  c.fill(circle(85, 40, 11), brown);
  return { W, H, c };
}

/** A tossed banana skin. */
function banana() {
  const W = 190, H = 130, c = new Canvas(W, H);
  const skin = (px, py) => {
    const t = (px - 20) / 150;
    if (t < 0 || t > 1) return false;
    const curve = 40 + Math.sin(t * Math.PI) * 46;
    return Math.abs(py - curve) < 18 - Math.abs(t - 0.5) * 14;
  };
  c.fill(skin, darken(C.butter, 0.55));
  c.fill((px, py) => skin(px, py + 5) && skin(px, py - 5), C.butter);
  return { W, H, c };
}

/* ------------------------------------------------------------------ impacts */

/** A ring of stars, for a dazed hit. */
function stars() {
  const W = 200, H = 120, c = new Canvas(W, H);
  for (const [x, y, r] of [[40, 62, 26], [100, 36, 32], [160, 66, 24]]) {
    c.fill(star(x, y, 5, r * 0.42, r, 0, 0.34), darken(C.butter, 0.55));
    c.fill(star(x, y, 5, r * 0.34, r * 0.82, 0, 0.34), C.butter);
  }
  return { W, H, c };
}









/** A crack, for something that has just been broken. */
function crack() {
  const W = 200, H = 200, c = new Canvas(W, H);
  const spokes = [0.4, 1.5, 2.6, 3.7, 4.8, 5.6];
  for (const angle of spokes) {
    const x2 = 100 + Math.cos(angle) * 92;
    const y2 = 100 + Math.sin(angle) * 92;
    c.fill(capsule(100, 100, x2, y2, 9), darken(C.ink, 0.9), 0.9);
    c.fill(capsule(100, 100, x2, y2, 5), C.ink);
  }
  return { W, H, c };
}

/** A slash, as left by something sharp. */
function slash() {
  const W = 240, H = 180, c = new Canvas(W, H);
  for (const [off, width] of [[0, 15], [40, 11], [-38, 9]]) {
    c.fill(capsule(30 + off, 20, 190 + off, 160, width + 5), darken(C.white, 0.6), 0.8);
    c.fill(capsule(32 + off, 24, 188 + off, 156, width), C.white, 0.95);
  }
  return { W, H, c };
}

/** A bubble, for underwater and for nonsense alike. */
function bubble() {
  const W = 120, H = 120, c = new Canvas(W, H);
  c.fill(ring(60, 60, 40, 50), darken(C.aqua, 0.5), 0.8);
  c.fill(ring(60, 60, 44, 48), C.white, 0.85);
  c.fill(ellipse(44, 42, 12, 9), C.white, 0.75);
  return { W, H, c };
}

/** A musical note, for singing and for taunts. */
function note() {
  const W = 130, H = 180, c = new Canvas(W, H);
  c.fill(ellipse(50, 138, 32, 24), darken(C.lavender, 0.55));
  c.fill(ellipse(50, 138, 26, 19), C.lavender);
  c.fill(capsule(76, 138, 76, 34, 8), darken(C.lavender, 0.55));
  c.fill(capsule(76, 134, 76, 38, 5), C.lavender);
  c.fill(capsule(76, 38, 112, 62, 11), C.lavender);
  return { W, H, c };
}

/** A love heart burst, larger and airier than the thrown heart. */
function hearts() {
  const W = 220, H = 170, c = new Canvas(W, H);
  for (const [x, y, r, a] of [[60, 96, 1, 1], [140, 74, 0.8, 0.9], [176, 122, 0.55, 0.8]]) {
    const shape = any(circle(x - 18 * r, y - 14 * r, 20 * r), circle(x + 18 * r, y - 14 * r, 20 * r),
      ellipse(x, y + 14 * r, 26 * r, 24 * r));
    c.fill(shape, darken(C.blossom, 0.6), a);
    c.fill((px, py) => shape(px + 5, py) && shape(px - 5, py), C.blossom, a);
  }
  return { W, H, c };
}

/** A question mark, for confusion. */
function confused() {
  const W = 120, H = 180, c = new Canvas(W, H);
  c.fill(arc(60, 62, 22, 40, -3.0, 0.9), darken(C.sky, 0.55));
  c.fill(arc(60, 62, 26, 36, -3.0, 0.9), C.sky);
  c.fill(capsule(60, 92, 60, 118, 16), darken(C.sky, 0.55));
  c.fill(capsule(60, 94, 60, 116, 12), C.sky);
  c.fill(circle(60, 150, 17), darken(C.sky, 0.55));
  c.fill(circle(60, 150, 13), C.sky);
  return { W, H, c };
}

/** An exclamation, for a surprise. */
function alert() {
  const W = 110, H = 190, c = new Canvas(W, H);
  const body = (px, py) => py < 128 && Math.abs(px - 55) < 22 - py * 0.07;
  c.fill(body, darken(C.coral, 0.55));
  c.fill((px, py) => body(px + 6, py) && body(px - 6, py), C.coral);
  c.fill(circle(55, 162, 20), darken(C.coral, 0.55));
  c.fill(circle(55, 162, 15), C.coral);
  return { W, H, c };
}

/** A sweat drop, for effort and for panic. */
function sweat() {
  const W = 100, H = 140, c = new Canvas(W, H);
  const drop = any(ellipse(50, 92, 34, 38), (px, py) => py < 92
    && Math.abs(px - 50) < (py - 18) * 0.42);
  c.fill(drop, darken(C.sky, 0.5));
  c.fill((px, py) => drop(px + 6, py) && drop(px - 6, py), C.sky);
  c.fill(ellipse(38, 92, 9, 13), C.white, 0.6);
  return { W, H, c };
}

/* ------------------------------------------------------------------ summons */

/** A cartoon bomb with a lit fuse. */
function bomb() {
  const W = 180, H = 200, c = new Canvas(W, H);
  c.fill(circle(88, 126, 66), darken(C.ink, 0.9));
  c.fill(circle(88, 126, 59), C.ink);
  c.fill(ellipse(64, 104, 16, 12), C.white, 0.35);
  c.fill(roundedRect(74, 44, 30, 26, 8), darken(C.peach, 0.6));
  c.fill(capsule(100, 44, 140, 16, 8), C.peach);
  c.fill(star(146, 12, 6, 5, 16, 0, 0.4), C.coral);
  return { W, H, c };
}

/** A falling safe, for slapstick. */
function safe() {
  const W = 200, H = 190, c = new Canvas(W, H);
  c.fill(outlineOf(18, 20, 164, 152, 22, OUTLINE), darken(C.sky, 0.65));
  c.fill(roundedRect(18, 20, 164, 152, 22), C.sky);
  c.fill(roundedRect(34, 36, 132, 120, 14), darken(C.sky, 0.85));
  c.fill(ring(100, 96, 20, 30), darken(C.ink, 0.9));
  c.fill(circle(100, 96, 12), C.ink);
  return { W, H, c };
}

/** A wheel of cheese, because a party game needs one. */
function cheese() {
  const W = 190, H = 160, c = new Canvas(W, H);
  const wedge = (px, py) => {
    const dx = px - 20, dy = py - 30;
    return dx > 0 && dy > 0 && dx * dx + dy * dy < 150 * 150 && dy < dx * 0.9;
  };
  c.fill(wedge, darken(C.butter, 0.6));
  c.fill((px, py) => wedge(px + 6, py) && wedge(px, py - 6), C.butter);
  for (const [x, y, r] of [[70, 62, 11], [104, 92, 14], [56, 96, 8], [126, 66, 7]]) {
    c.fill(circle(x, y, r), darken(C.butter, 0.78));
  }
  return { W, H, c };
}

/** A fish, for slapping people with. */
function fish() {
  const W = 220, H = 130, c = new Canvas(W, H);
  const body = ellipse(112, 66, 76, 40);
  const tail = (px, py) => px < 44 && Math.abs(py - 66) < (44 - px) * 0.9;
  c.fill(any(body, tail), darken(C.aqua, 0.55));
  c.fill((px, py) => (body(px + 6, py) && body(px - 6, py)) || (tail(px + 5, py) && tail(px, py)),
    C.aqua);
  c.fill(circle(154, 54, 9), C.white);
  c.fill(circle(156, 54, 5), C.ink);
  return { W, H, c };
}

/** A clenched fist, for a punch that lands. */
function fist() {
  const W = 170, H = 160, c = new Canvas(W, H);
  const hand = any(roundedRect(30, 36, 110, 92, 34), roundedRect(110, 56, 40, 56, 18));
  c.fill(hand, darken(C.peach, 0.6));
  c.fill((px, py) => hand(px + 6, py) && hand(px - 6, py) && hand(px, py + 6), C.peach);
  for (const y of [60, 84, 108]) c.fill(capsule(46, y, 96, y, 4), darken(C.peach, 0.78));
  return { W, H, c };
}

/** A boot, for the kick that follows. */
function boot() {
  const W = 200, H = 150, c = new Canvas(W, H);
  const shoe = any(roundedRect(40, 20, 56, 92, 18), roundedRect(40, 84, 132, 44, 20));
  c.fill(shoe, darken(C.lavender, 0.6));
  c.fill((px, py) => shoe(px + 6, py) && shoe(px - 6, py) && shoe(px, py + 6), C.lavender);
  c.fill(roundedRect(44, 112, 124, 16, 8), darken(C.ink, 0.95));
  return { W, H, c };
}

/** A tooth, knocked loose. */
function tooth() {
  const W = 110, H = 130, c = new Canvas(W, H);
  const shape = any(roundedRect(22, 20, 66, 62, 24),
    (px, py) => py > 70 && py < 118 && (Math.abs(px - 40) < 14 || Math.abs(px - 72) < 14));
  c.fill(shape, darken(C.white, 0.62));
  c.fill((px, py) => shape(px + 5, py) && shape(px - 5, py), C.white);
  return { W, H, c };
}

/** A shield, for anything defensive. */
function shield() {
  const W = 170, H = 190, c = new Canvas(W, H);
  const plate = (px, py) => {
    const t = py / H;
    const half = 74 - t * t * 62;
    return py > 14 && py < 180 && Math.abs(px - 85) < half;
  };
  c.fill(plate, darken(C.sky, 0.6));
  c.fill((px, py) => plate(px + 7, py) && plate(px - 7, py) && plate(px, py + 7), C.sky);
  c.fill(capsule(85, 40, 85, 150, 9), C.white, 0.55);
  return { W, H, c };
}

/** A clock, for anything about time. */
function clock() {
  const W = 160, H = 160, c = new Canvas(W, H);
  c.fill(circle(80, 80, 68), darken(C.white, 0.6));
  c.fill(circle(80, 80, 60), C.white);
  c.fill(capsule(80, 80, 80, 38, 6), C.ink);
  c.fill(capsule(80, 80, 112, 92, 6), C.ink);
  c.fill(circle(80, 80, 8), C.ink);
  return { W, H, c };
}

/** A coin, for anything about luck or money. */
function coin() {
  const W = 130, H = 130, c = new Canvas(W, H);
  c.fill(circle(65, 65, 56), darken(C.butter, 0.6));
  c.fill(circle(65, 65, 48), C.butter);
  c.fill(ring(65, 65, 30, 36), darken(C.butter, 0.8));
  c.fill(ellipse(48, 44, 13, 9), C.white, 0.5);
  return { W, H, c };
}

/** A snowflake, for cold. */
function snowflake() {
  const W = 160, H = 160, c = new Canvas(W, H);
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const x2 = 80 + Math.cos(angle) * 70;
    const y2 = 80 + Math.sin(angle) * 70;
    c.fill(capsule(80, 80, x2, y2, 10), darken(C.aqua, 0.5));
    c.fill(capsule(80, 80, x2, y2, 6), C.white);
  }
  c.fill(circle(80, 80, 13), C.white);
  return { W, H, c };
}

/** A leaf, for anything of the garden. */
function leaf() {
  const W = 160, H = 170, c = new Canvas(W, H);
  const shape = (px, py) => {
    const t = py / H;
    const half = Math.sin(t * Math.PI) * 56;
    return Math.abs(px - 80 - (t - 0.5) * 30) < half;
  };
  c.fill(shape, darken(C.mint, 0.6));
  c.fill((px, py) => shape(px + 6, py) && shape(px - 6, py), C.mint);
  c.fill(capsule(64, 156, 100, 26, 4), darken(C.mint, 0.78));
  return { W, H, c };
}

/** A rain shower. */
function rain() {
  const W = 220, H = 200, c = new Canvas(W, H);
  c.fill(any(ellipse(96, 56, 62, 34), ellipse(140, 48, 40, 28), ellipse(58, 50, 34, 24)),
    darken(C.sky, 0.7), 0.75);
  for (const [x, y] of [[52, 112], [92, 132], [134, 116], [172, 140], [72, 164], [150, 172]]) {
    c.fill(capsule(x, y, x - 10, y + 30, 6), C.sky, 0.9);
  }
  return { W, H, c };
}

/** A flying kiss, for the sillier prompts. */
function kiss() {
  const W = 150, H = 130, c = new Canvas(W, H);
  const lips = any(ellipse(58, 66, 34, 24), ellipse(96, 66, 34, 24));
  c.fill(lips, darken(C.coral, 0.6));
  c.fill((px, py) => lips(px + 6, py) && lips(px, py + 6), C.coral);
  c.fill(capsule(24, 66, 128, 66, 4), darken(C.coral, 0.8));
  return { W, H, c };
}

/** A slime splat. */
function slime() {
  const W = 200, H = 150, c = new Canvas(W, H);
  const splat = any(ellipse(100, 96, 74, 40), circle(44, 60, 20), circle(158, 56, 16),
    circle(78, 44, 12));
  c.fill(splat, darken(C.mint, 0.62));
  c.fill((px, py) => splat(px + 6, py) && splat(px - 6, py), C.mint);
  c.fill(ellipse(78, 86, 18, 10), C.white, 0.45);
  return { W, H, c };
}

/** A tornado. */
function tornado() {
  const W = 200, H = 240, c = new Canvas(W, H);
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const y = 24 + t * 190;
    const half = 82 - t * 66;
    const drift = Math.sin(t * 5) * 14;
    c.fill(ellipse(100 + drift, y, half, 14 - t * 6), darken(C.aqua, 0.55), 0.85);
    c.fill(ellipse(100 + drift, y, half - 7, 9 - t * 4), C.aqua, 0.95);
  }
  return { W, H, c };
}

/** A flying pan, for the kitchen-sink prompts. */
function pan() {
  const W = 230, H = 140, c = new Canvas(W, H);
  const body = any(ellipse(84, 78, 62, 44), roundedRect(140, 62, 78, 24, 12));
  c.fill(body, darken(C.ink, 0.95));
  c.fill((px, py) => body(px + 6, py) && body(px - 6, py) && body(px, py + 6), C.ink);
  c.fill(ellipse(76, 62, 26, 14), C.white, 0.25);
  return { W, H, c };
}

/** A spray of confetti, for a finishing flourish. */
function confetti() {
  const W = 240, H = 200, c = new Canvas(W, H);
  const colours = [C.coral, C.butter, C.mint, C.sky, C.lavender, C.blossom];
  let i = 0;
  for (const [x, y, r] of [[40, 40, 14], [96, 24, 11], [150, 52, 13], [200, 30, 10],
    [64, 104, 12], [126, 92, 15], [188, 118, 11], [44, 162, 10], [110, 168, 13],
    [176, 176, 12], [216, 84, 9], [86, 60, 8]]) {
    c.fill(roundedRect(x - r, y - r, r * 2, r * 2, 4), colours[i % colours.length]);
    i++;
  }
  return { W, H, c };
}

const effects = {
  fire, sun, star: starShot, ice, heart, rock,
  beam, charge,
  soundwave, shockring, wave,
  drone, meteor, anvil, piano,
  impact, sparkle, dizzy, whoosh,

  // Thrown and fired.
  bullet, arrow, pebble, splash, bolt, banana,
  // Air, weather and the unmentionable.
  wind, dust, smoke, stink, poop, rain, tornado, snowflake, leaf,
  // Marks left on somebody.
  stars, crack, slash, bubble, note, hearts, confused, alert, sweat, kiss, slime,
  // Things that arrive from off screen.
  bomb, safe, cheese, fish, fist, boot, tooth, shield, clock, coin, pan, confetti,
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
