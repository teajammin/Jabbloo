import gsap from 'gsap';
import { spawnEffect } from '../effects';
import {
  LimbDriver, burst, clamp, contactPoint, directionToEnemy, duration, fadeOut,
} from './util';
import { GROUND_Y } from '../types';
import type {
  FlipParams, HandspringParams, PrimitiveContext, TauntParams, TeleportParams,
} from './types';

/** Whole-body performance: flips, springs, teleports and showing off. */

/** Rotates the body through full turns while airborne. */
export function flip(ctx: PrimitiveContext, params: FlipParams = {}) {
  const rotations = clamp(params.rotations, 1, 4, 1);
  const seconds = duration(params.duration, 0.9);
  const forward = params.forward !== false;
  const dir = directionToEnemy(ctx);
  const ground = ctx.stage.height * GROUND_Y;

  const tl = gsap.timeline();
  tl.to(ctx.actor.body, { scaleY: 0.85, scaleX: 1.12, duration: seconds * 0.12 });
  tl.to(ctx.actor.body, { scaleY: 1, scaleX: 1, duration: seconds * 0.12 });
  tl.to(ctx.actor.root, { y: ground - 180, duration: seconds * 0.38, ease: 'power2.out' }, '<');
  tl.to(
    ctx.actor.body,
    {
      rotation: (forward ? dir : -dir) * Math.PI * 2 * rotations,
      duration: seconds * 0.7,
      ease: 'none',
    },
    '<',
  );
  tl.to(ctx.actor.root, { y: ground, duration: seconds * 0.38, ease: 'power2.in' });
  // Land square: clear the accumulated rotation rather than leaving it wound up.
  tl.call(() => { ctx.actor.body.rotation = 0; });
  tl.to(ctx.actor.body, { scaleY: 0.86, scaleX: 1.14, duration: seconds * 0.08 });
  tl.to(ctx.actor.body, { scaleY: 1, scaleX: 1, duration: seconds * 0.22, ease: 'elastic.out(1, 0.5)' });
  return tl;
}

/** Front handspring into a kick — travels forward, ends on contact. */
export function handspring(ctx: PrimitiveContext, params: HandspringParams = {}) {
  const seconds = duration(params.duration, 1.2);
  const dir = directionToEnemy(ctx);
  const ground = ctx.stage.height * GROUND_Y;
  const target = ctx.enemy.root.x - dir * (ctx.actor.width * 0.5 + ctx.enemy.width * 0.5);
  const leg = new LimbDriver(ctx.actor.leg, 2.4);

  const tl = gsap.timeline();
  // Dive onto the hands.
  tl.to(ctx.actor.body, { rotation: dir * 1.2, duration: seconds * 0.22, ease: 'power2.in' });
  tl.to(ctx.actor.root, { x: `+=${dir * 90}`, duration: seconds * 0.22, ease: 'none' }, '<');
  tl.to(ctx.actor.root, { y: ground - 60, duration: seconds * 0.22, ease: 'power2.out' }, '<');

  // Whip over.
  tl.to(ctx.actor.body, { rotation: dir * Math.PI * 2, duration: seconds * 0.34, ease: 'power1.inOut' });
  tl.to(ctx.actor.root, { x: target, duration: seconds * 0.34, ease: 'none' }, '<');
  tl.to(ctx.actor.root, { y: ground - 120, duration: seconds * 0.17, ease: 'power2.out' }, '<');
  tl.to(ctx.actor.root, { y: ground, duration: seconds * 0.17, ease: 'power2.in' });

  tl.call(() => { ctx.actor.body.rotation = 0; });

  // Finish with the kick.
  leg.show(tl);
  leg.to(tl, { angle: 2.2, length: 60 }, seconds * 0.1, 'power2.out');
  leg.to(tl, { angle: -0.1, length: 150 }, seconds * 0.14, 'power4.in');
  tl.to(ctx.actor.body, { rotation: dir * 0.24, duration: seconds * 0.14 }, '<');

  burst(tl, ctx, 'impact', contactPoint(ctx), 210);

  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.2, ease: 'power2.out' });
  leg.hide(tl, seconds * 0.16, '<');
  return tl;
}

/** Vanishes and reappears elsewhere, with speed lines at both ends. */
export function teleport(ctx: PrimitiveContext, params: TeleportParams = {}) {
  const seconds = duration(params.duration, 0.6);
  const to = params.to ?? 'behind';
  const dir = directionToEnemy(ctx);
  const gap = ctx.actor.width * 0.5 + ctx.enemy.width * 0.5;
  const ground = ctx.stage.height * GROUND_Y;

  // "Behind" means the far side of the opponent — which flips who faces whom.
  const destination =
    to === 'behind'
      ? { x: ctx.enemy.root.x + dir * gap, y: ground }
      : to === 'above'
        ? { x: ctx.enemy.root.x, y: ground - 200 }
        : { x: ctx.enemy.root.x - dir * gap, y: ground };

  const tl = gsap.timeline();

  tl.call(() => {
    const whoosh = spawnEffect(ctx.stage.effects, 'whoosh', {
      x: ctx.actor.root.x,
      y: ctx.actor.root.y - ctx.actor.height * 0.5,
      height: 120,
      flip: dir < 0,
      alpha: 0.9,
    });
    gsap.to(whoosh, { alpha: 0, duration: 0.3, onComplete: () => whoosh.destroy() });
  });

  tl.to(ctx.actor.body, { scaleX: 0.3, scaleY: 1.25, duration: seconds * 0.25, ease: 'power2.in' });
  tl.to(ctx.actor.root, { alpha: 0, duration: seconds * 0.25 }, '<');

  tl.call(() => {
    ctx.actor.root.x = destination.x;
    ctx.actor.root.y = destination.y;
    if (to === 'behind') ctx.actor.facing = ctx.actor.facing === 'right' ? 'left' : 'right';
  });

  tl.to(ctx.actor.root, { alpha: 1, duration: seconds * 0.25 });
  tl.to(ctx.actor.body, { scaleX: 1, scaleY: 1, duration: seconds * 0.5, ease: 'elastic.out(1, 0.5)' }, '<');

  burst(tl, ctx, 'sparkle', { x: destination.x, y: destination.y - ctx.actor.height * 0.5 }, 120, '<');
  return tl;
}

/**
 * Showing off.
 *
 * Twerk turns the character away from the opponent first, because the joke
 * needs the orientation.
 */
export function taunt(ctx: PrimitiveContext, params: TauntParams = {}) {
  const seconds = duration(params.duration, 1.1);
  const style = params.style ?? 'twerk';
  const dir = directionToEnemy(ctx);
  const tl = gsap.timeline();

  if (style === 'twerk') {
    const facing = ctx.actor.facing;
    tl.call(() => { ctx.actor.facing = facing === 'right' ? 'left' : 'right'; });
    tl.to(ctx.actor.body, { scaleY: 0.9, scaleX: 1.08, duration: seconds * 0.12 });

    const bounces = 5;
    const each = (seconds * 0.7) / (bounces * 2);
    for (let i = 0; i < bounces; i++) {
      tl.to(ctx.actor.body, { y: 18, scaleY: 0.82, scaleX: 1.14, duration: each, ease: 'power2.in' });
      tl.to(ctx.actor.body, { y: 0, scaleY: 0.96, scaleX: 1.02, duration: each, ease: 'power2.out' });
    }

    tl.to(ctx.actor.body, { scaleY: 1, scaleX: 1, duration: seconds * 0.12 });
    tl.call(() => { ctx.actor.facing = facing; });
    return tl;
  }

  if (style === 'dance') {
    const steps = 4;
    const each = seconds / (steps * 2);
    for (let i = 0; i < steps; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      tl.to(ctx.actor.root, { x: `+=${side * 26}`, duration: each, ease: 'sine.inOut' });
      tl.to(ctx.actor.body, { rotation: side * 0.16, y: -14, duration: each }, '<');
      tl.to(ctx.actor.root, { x: `-=${side * 26}`, duration: each, ease: 'sine.inOut' });
      tl.to(ctx.actor.body, { rotation: 0, y: 0, duration: each }, '<');
    }
    return tl;
  }

  if (style === 'bow') {
    tl.to(ctx.actor.body, { rotation: dir * 0.6, y: 16, duration: seconds * 0.35, ease: 'power2.out' });
    tl.to(ctx.actor.body, { rotation: dir * 0.6, duration: seconds * 0.3 });
    tl.to(ctx.actor.body, { rotation: 0, y: 0, duration: seconds * 0.35, ease: 'back.out(2)' });
    return tl;
  }

  // point
  const arm = new LimbDriver(ctx.actor.arm, 1.4);
  arm.show(tl);
  arm.to(tl, { angle: -0.25, length: 105 }, seconds * 0.25, 'back.out(3)');
  tl.to(ctx.actor.body, { rotation: dir * 0.14, duration: seconds * 0.25 }, '<');
  tl.call(() => {
    const spark = spawnEffect(ctx.stage.effects, 'sparkle', {
      x: ctx.enemy.root.x,
      y: ctx.enemy.root.y - ctx.enemy.height,
      height: 90,
    });
    gsap.to(spark, { alpha: 0, duration: 0.5, onComplete: () => spark.destroy() });
  });
  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.3, ease: 'power2.out' }, `+=${seconds * 0.2}`);
  arm.hide(tl, seconds * 0.2, '<');
  return tl;
}

/** Exported for the registry; keeps fadeOut referenced for future ranged use. */
export const __acrobaticsHelpers = { fadeOut };
