import gsap from 'gsap';
import { spawnEffect } from '../effects';
import { clamp, directionToEnemy, duration } from './util';
import type {
  DizzyParams, GrowParams, InhaleParams, KnockdownParams, PrimitiveContext, ShrinkParams,
} from './types';

/**
 * Transformations and reactions.
 *
 * `knockdown` and `dizzy` are written to be used with `on: "enemy"` — they are
 * how a choreography shows the opponent being affected rather than only showing
 * the attacker performing.
 */

/** Kirby-style suction: the opponent is dragged in and shrunk. */
export function inhale(ctx: PrimitiveContext, params: InhaleParams = {}) {
  const seconds = duration(params.duration, 1.4);
  const dir = directionToEnemy(ctx);
  const enemyHome = ctx.enemy.root.x;
  const pullTo = ctx.actor.root.x + dir * (ctx.actor.width * 0.6);

  const tl = gsap.timeline();

  // Draw breath.
  tl.to(ctx.actor.body, { scaleX: 0.86, scaleY: 1.1, duration: seconds * 0.2, ease: 'power2.out' });

  tl.call(() => {
    const wind = spawnEffect(ctx.stage.effects, 'soundwave', {
      x: ctx.actor.root.x + dir * ctx.actor.width * 0.5,
      y: ctx.actor.root.y - ctx.actor.height * 0.5,
      height: 200,
      // Rings point back toward the mouth, since air is going in, not out.
      flip: dir > 0,
      alpha: 0.75,
    });
    gsap.to(wind, { alpha: 0, duration: seconds * 0.5, onComplete: () => wind.destroy() });
  });

  // Balloon up as the opponent is hauled in and squashed down.
  tl.to(ctx.actor.body, { scaleX: 1.35, scaleY: 1.3, duration: seconds * 0.45, ease: 'power2.in' }, '<');
  tl.to(ctx.enemy.root, { x: pullTo, duration: seconds * 0.45, ease: 'power2.in' }, '<');
  tl.to(ctx.enemy.body, { scaleX: 0.55, scaleY: 0.55, rotation: dir * 0.5, duration: seconds * 0.45 }, '<');

  // Spit them back out.
  tl.to(ctx.actor.body, { scaleX: 0.9, scaleY: 0.94, duration: seconds * 0.12, ease: 'power3.in' });
  tl.to(ctx.enemy.root, { x: enemyHome, duration: seconds * 0.23, ease: 'power3.out' });
  tl.to(ctx.enemy.body, { scaleX: 1, scaleY: 1, rotation: 0, duration: seconds * 0.23 }, '<');
  tl.to(ctx.actor.body, { scaleX: 1, scaleY: 1, duration: seconds * 0.2, ease: 'elastic.out(1, 0.5)' }, '<');
  return tl;
}

export function grow(ctx: PrimitiveContext, params: GrowParams = {}) {
  const scale = clamp(params.scale, 1.05, 3, 1.8);
  const seconds = duration(params.duration, 0.7);

  const tl = gsap.timeline();
  tl.to(ctx.actor.body, { scaleX: 0.9, scaleY: 0.9, duration: seconds * 0.2, ease: 'power2.in' });
  tl.to(ctx.actor.body, { scaleX: scale, scaleY: scale, duration: seconds * 0.5, ease: 'back.out(2)' });
  tl.call(() => {
    const spark = spawnEffect(ctx.stage.effects, 'sparkle', {
      x: ctx.actor.root.x,
      y: ctx.actor.root.y - ctx.actor.height * scale * 0.9,
      height: 130,
    });
    gsap.to(spark, { alpha: 0, duration: 0.5, onComplete: () => spark.destroy() });
  });
  tl.to({}, { duration: seconds * 0.3 });
  return tl;
}

export function shrink(ctx: PrimitiveContext, params: ShrinkParams = {}) {
  const scale = clamp(params.scale, 0.2, 0.95, 0.5);
  const seconds = duration(params.duration, 0.6);

  const tl = gsap.timeline();
  tl.to(ctx.actor.body, { scaleX: 1.12, scaleY: 1.12, duration: seconds * 0.2, ease: 'power2.out' });
  tl.to(ctx.actor.body, { scaleX: scale, scaleY: scale, duration: seconds * 0.5, ease: 'back.in(1.6)' });
  tl.to({}, { duration: seconds * 0.3 });
  return tl;
}

/** Flat on their back, with stars. Intended for `on: "enemy"`. */
export function knockdown(ctx: PrimitiveContext, params: KnockdownParams = {}) {
  const seconds = duration(params.duration, 0.9);
  const dir = directionToEnemy(ctx);
  const origin = ctx.actor.root.x;

  const tl = gsap.timeline();
  // Tip over away from whoever hit them.
  tl.to(ctx.actor.body, { rotation: -dir * 0.4, duration: seconds * 0.18, ease: 'power2.out' });
  tl.to(ctx.actor.root, { x: origin - dir * 70, duration: seconds * 0.3, ease: 'power2.out' }, '<');
  tl.to(ctx.actor.body, { rotation: -dir * 1.5, duration: seconds * 0.22, ease: 'power3.in' });
  tl.to(ctx.actor.body, { y: ctx.actor.height * 0.34, duration: seconds * 0.22, ease: 'power3.in' }, '<');

  tl.call(() => {
    const stars = spawnEffect(ctx.stage.effects, 'dizzy', {
      x: ctx.actor.root.x - dir * ctx.actor.width * 0.4,
      y: ctx.actor.root.y - ctx.actor.height * 0.55,
      height: 110,
    });
    gsap.to(stars, { rotation: Math.PI * 2, duration: 1.2, ease: 'none' });
    gsap.to(stars, { alpha: 0, duration: 0.4, delay: 0.7, onComplete: () => stars.destroy() });
  });

  // Stay down a beat, then get back up.
  tl.to({}, { duration: seconds * 0.24 });
  tl.to(ctx.actor.body, { rotation: 0, y: 0, duration: seconds * 0.36, ease: 'back.out(1.4)' });
  tl.to(ctx.actor.root, { x: origin, duration: seconds * 0.36, ease: 'power2.out' }, '<');
  return tl;
}

/** Stunned, wobbling, seeing stars. Intended for `on: "enemy"`. */
export function dizzy(ctx: PrimitiveContext, params: DizzyParams = {}) {
  const seconds = duration(params.duration, 1);

  const tl = gsap.timeline();
  tl.call(() => {
    const stars = spawnEffect(ctx.stage.effects, 'dizzy', {
      x: ctx.actor.root.x,
      y: ctx.actor.root.y - ctx.actor.height * 1.05,
      height: 120,
    });
    gsap.to(stars, { rotation: Math.PI * 2, duration: seconds, ease: 'none' });
    gsap.to(stars, { alpha: 0, duration: 0.3, delay: seconds - 0.3, onComplete: () => stars.destroy() });
  });

  const wobbles = 4;
  const each = seconds / (wobbles * 2);
  for (let i = 0; i < wobbles; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    tl.to(ctx.actor.body, { rotation: side * 0.16, duration: each, ease: 'sine.inOut' });
    tl.to(ctx.actor.body, { rotation: 0, duration: each, ease: 'sine.inOut' });
  }
  return tl;
}
