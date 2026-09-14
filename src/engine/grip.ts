import type { Texture } from 'pixi.js';
import { silhouetteOf, type Silhouette } from './limbs';

/**
 * Working out how a drawn weapon should be held.
 *
 * A player draws a sword pointing up, an axe pointing left, a baguette lying
 * flat — and the rig held all of them by the middle of the bottom edge,
 * pointing wherever the drawing happened to point. Swinging a weapon that is
 * already upside down reads as a bug in a way nobody can name but everybody
 * sees.
 *
 * Two things are wanted from the picture: which way the weapon runs, and which
 * end of it is the handle. The first is the direction of its longest axis. The
 * second is the thinner, plainer end — a handle is narrow and a blade, head or
 * business end is not, in almost every weapon anybody draws.
 *
 * Deliberately measurement rather than a model. It is free, instant, offline,
 * and on crayon-thick shapes about as reliable — and unlike a vision call it
 * cannot invent an answer for a drawing that is genuinely ambiguous.
 */

export interface Grip {
  /**
   * Where on the sprite the hand holds it, as fractions of its own size:
   * 0,0 is the top-left corner of the image and 1,1 the bottom-right.
   */
  x: number;
  y: number;
  /**
   * How far the weapon must be turned so that it points away from the holder,
   * in radians. Zero means the drawing already points the right way.
   */
  rotation: number;
  /** How sure the measurement is, 0 to 1. Low means leave the drawing alone. */
  confidence: number;
}

/** What the rig does when a weapon tells it nothing: hold the bottom, as drawn. */
export const DEFAULT_GRIP: Grip = { x: 0.5, y: 0.86, rotation: 0, confidence: 0 };

/**
 * Reads a grip out of a silhouette.
 *
 * Separated from the texture so it can be tested against shapes built by hand
 * rather than judged by eye on a phone.
 */
export function findGrip(mask: Silhouette | null): Grip {
  if (!mask) return DEFAULT_GRIP;

  // Every opaque pixel, as a cloud of points to measure.
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x] !== 1) continue;
      count++;
      sumX += x;
      sumY += y;
    }
  }
  if (count < 24) return DEFAULT_GRIP;

  const meanX = sumX / count;
  const meanY = sumY / count;

  /*
   * The long axis, by the spread of the pixels about their own centre.
   *
   * This is the covariance of the cloud; its principal direction is the line
   * the weapon lies along, whatever angle it was drawn at. Simpler than
   * fitting a shape, and it does not care whether the thing is a sword, a
   * frying pan or a fish.
   */
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x] !== 1) continue;
      const dx = x - meanX;
      const dy = y - meanY;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
  }
  xx /= count; yy /= count; xy /= count;

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axisX = Math.cos(angle);
  const axisY = Math.sin(angle);

  // How elongated it is. A broadly round weapon — a shield, a ball — has no
  // meaningful direction, and saying so is better than guessing one.
  const common = (xx + yy) / 2;
  const diff = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
  const major = common + diff;
  const minor = Math.max(1e-6, common - diff);
  const elongation = Math.sqrt(major / minor);
  if (elongation < 1.35) return DEFAULT_GRIP;

  /*
   * Which end is the handle: the lighter, thinner one.
   *
   * The cloud is split along its own axis and the halves compared two ways —
   * how much of the drawing is in each, and how wide each gets. A blade, a
   * head, a pan: the working end is both heavier and broader, and the hand
   * goes on the other. Weight is the stronger signal of the two, because a
   * long thin blade can be barely wider than the handle it is attached to
   * while being most of the picture.
   */
  let nearCount = 0;
  let farCount = 0;
  let nearWidest = 0;
  let farWidest = 0;
  let minAlong = Infinity;
  let maxAlong = -Infinity;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x] !== 1) continue;
      const dx = x - meanX;
      const dy = y - meanY;
      const along = dx * axisX + dy * axisY;
      const across = Math.abs(-dx * axisY + dy * axisX);
      if (along < minAlong) minAlong = along;
      if (along > maxAlong) maxAlong = along;
      if (along < 0) {
        nearCount++;
        if (across > nearWidest) nearWidest = across;
      } else {
        farCount++;
        if (across > farWidest) farWidest = across;
      }
    }
  }

  const heavier = Math.max(nearCount, farCount);
  const lighter = Math.max(1, Math.min(nearCount, farCount));
  const byWeight = (heavier - lighter) / heavier;
  const byWidth = Math.abs(nearWidest - farWidest) / Math.max(1, Math.max(nearWidest, farWidest));

  // The handle is at the lighter end; the weapon points away from it.
  const handleIsNear = nearCount <= farCount;
  const handleAlong = handleIsNear ? minAlong : maxAlong;
  const pointing = handleIsNear ? angle : angle + Math.PI;

  // A little in from the very tip, so the hand is on the handle rather than
  // off the end of it.
  const inset = 0.14 * (maxAlong - minAlong);
  const gripAlong = handleAlong + (handleIsNear ? inset : -inset);

  const gripX = meanX + gripAlong * axisX;
  const gripY = meanY + gripAlong * axisY;

  /*
   * How far to turn it.
   *
   * The rig swings a weapon that points to the right, so the drawing is turned
   * until its business end does. Facing is handled by mirroring the fighter,
   * so this only ever has to solve for one direction.
   */
  const rotation = normalise(-pointing);

  // Confident when the shape is clearly long and clearly one-ended. Either
  // signal alone is enough to be sure about: a mostly-blade sword is obvious
  // by weight, a mallet by width.
  const lopsided = Math.max(byWeight, byWidth);
  const confidence = Math.min(1, (elongation - 1.35) / 1.4) * Math.min(1, lopsided * 2.2);

  return {
    x: gripX / mask.width,
    y: gripY / mask.height,
    rotation,
    confidence,
  };
}

/** Turns any angle into the equivalent between -PI and PI. */
function normalise(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Reads a grip from a loaded texture. */
export function gripFor(texture: Texture): Grip {
  return findGrip(silhouetteOf(texture));
}
