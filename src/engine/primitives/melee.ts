import gsap from 'gsap';
import {
  LimbDriver, burst, contactPoint, directionToEnemy, duration,
} from './util';
import type {
  BiteParams, GrabParams, HeadbuttParams, KickParams, LickParams,
  PrimitiveContext, PunchParams, StompParams,
} from './types';

/**
 * Close-quarters moves.
 *
 * Kicks and punches drive the procedural limbs; bites, licks and headbutts are
 * whole-body lunges, since there is no mouth to animate on an arbitrary player
 * drawing. Every one lands its impact burst at the opponent's near edge rather
 * than at the actor, so the hit reads as connecting.
 */

/** Radians. Limb angles: 0 points forward, PI/2 points down. */
const KICKS = {
  roundhouse: { wind: 2.5, strike: -0.15, length: 140, ease: 'power4.in' },
  front: { wind: 1.9, strike: 0.05, length: 150, ease: 'power4.in' },
  sweep: { wind: 2.2, strike: 0.55, length: 165, ease: 'power3.in' },
} as const;

export function kick(ctx: PrimitiveContext, params: KickParams = {}) {
  const seconds = duration(params.duration, 0.7);
  const style = params.style && params.style in KICKS ? params.style : 'roundhouse';
  const { wind, strike, length, ease } = KICKS[style];
  const dir = directionToEnemy(ctx);
  const leg = new LimbDriver(ctx.actor.leg, wind);

  const tl = gsap.timeline();
  leg.show(tl);

  // Wind up: lean back, leg cocked.
  leg.to(tl, { angle: wind, length: length * 0.55 }, seconds * 0.3, 'power2.out', 0);
  tl.to(ctx.actor.body, { rotation: -dir * 0.16, duration: seconds * 0.3 }, 0);

  // Strike.
  leg.to(tl, { angle: strike, length }, seconds * 0.22, ease);
  tl.to(ctx.actor.body, { rotation: dir * 0.2, duration: seconds * 0.22 }, '<');
  tl.to(ctx.actor.root, { x: `+=${dir * 34}`, duration: seconds * 0.22 }, '<');

  burst(tl, ctx, 'impact', contactPoint(ctx), 190);

  // Recover.
  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.35, ease: 'power2.out' });
  tl.to(ctx.actor.root, { x: `-=${dir * 34}`, duration: seconds * 0.35 }, '<');
  leg.hide(tl, seconds * 0.25, '<');
  return tl;
}

const PUNCHES = {
  jab: { wind: 1.4, strike: -0.05, length: 105, lift: 0 },
  uppercut: { wind: 1.5, strike: -1.15, length: 115, lift: -26 },
  hook: { wind: 2.4, strike: -0.25, length: 100, lift: 0 },
} as const;

export function punch(ctx: PrimitiveContext, params: PunchParams = {}) {
  const seconds = duration(params.duration, 0.55);
  const style = params.style && params.style in PUNCHES ? params.style : 'jab';
  const { wind, strike, length, lift } = PUNCHES[style];
  const dir = directionToEnemy(ctx);
  const arm = new LimbDriver(ctx.actor.arm, wind);

  const tl = gsap.timeline();
  arm.show(tl);

  arm.to(tl, { angle: wind, length: length * 0.4 }, seconds * 0.3, 'power2.out', 0);
  tl.to(ctx.actor.body, { rotation: -dir * 0.12, duration: seconds * 0.3 }, 0);

  arm.to(tl, { angle: strike, length }, seconds * 0.2, 'power4.in');
  tl.to(ctx.actor.body, { rotation: dir * 0.14, y: lift, duration: seconds * 0.2 }, '<');
  tl.to(ctx.actor.root, { x: `+=${dir * 26}`, duration: seconds * 0.2 }, '<');

  burst(tl, ctx, 'impact', contactPoint(ctx), style === 'uppercut' ? 210 : 170);

  tl.to(ctx.actor.body, { rotation: 0, y: 0, duration: seconds * 0.35, ease: 'power2.out' });
  tl.to(ctx.actor.root, { x: `-=${dir * 26}`, duration: seconds * 0.35 }, '<');
  arm.hide(tl, seconds * 0.25, '<');
  return tl;
}

/** A running head-first lunge. */
export function headbutt(ctx: PrimitiveContext, params: HeadbuttParams = {}) {
  const seconds = duration(params.duration, 0.6);
  const dir = directionToEnemy(ctx);
  const origin = ctx.actor.root.x;
  const target = ctx.enemy.root.x - dir * (ctx.actor.width * 0.5 + ctx.enemy.width * 0.45);

  const tl = gsap.timeline();
  tl.to(ctx.actor.root, { x: origin - dir * 30, duration: seconds * 0.28, ease: 'power2.out' });
  tl.to(ctx.actor.body, { rotation: -dir * 0.2, duration: seconds * 0.28 }, 0);
  tl.to(ctx.actor.root, { x: target, duration: seconds * 0.26, ease: 'power4.in' });
  tl.to(ctx.actor.body, { rotation: dir * 0.5, duration: seconds * 0.26 }, '<');

  burst(tl, ctx, 'impact', contactPoint(ctx), 200);

  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.46, ease: 'elastic.out(1, 0.6)' });
  tl.to(ctx.actor.root, { x: origin, duration: seconds * 0.46, ease: 'power2.out' }, '<');
  return tl;
}

/** Chomp: lunge in, squash twice like a jaw, retreat. */
export function bite(ctx: PrimitiveContext, params: BiteParams = {}) {
  const seconds = duration(params.duration, 0.7);
  const dir = directionToEnemy(ctx);
  const origin = ctx.actor.root.x;
  const target = ctx.enemy.root.x - dir * (ctx.actor.width * 0.5 + ctx.enemy.width * 0.4);

  const tl = gsap.timeline();
  tl.to(ctx.actor.root, { x: target, duration: seconds * 0.3, ease: 'power3.in' });

  // Two quick chomps.
  for (let i = 0; i < 2; i++) {
    tl.to(ctx.actor.body, { scaleY: 0.78, scaleX: 1.18, duration: seconds * 0.09, ease: 'power3.in' });
    tl.to(ctx.actor.body, { scaleY: 1, scaleX: 1, duration: seconds * 0.09, ease: 'power2.out' });
  }

  burst(tl, ctx, 'impact', contactPoint(ctx), 150);
  tl.to(ctx.actor.root, { x: origin, duration: seconds * 0.34, ease: 'power2.out' });
  return tl;
}

/** A slow, deeply unwelcome lick. Hearts, because it is funnier than damage. */
export function lick(ctx: PrimitiveContext, params: LickParams = {}) {
  const seconds = duration(params.duration, 0.9);
  const dir = directionToEnemy(ctx);
  const origin = ctx.actor.root.x;
  const target = ctx.enemy.root.x - dir * (ctx.actor.width * 0.5 + ctx.enemy.width * 0.42);
  const arm = new LimbDriver(ctx.actor.arm, 1.2);

  const tl = gsap.timeline();
  tl.to(ctx.actor.root, { x: target, duration: seconds * 0.3, ease: 'power2.inOut' });

  // A slow upward drag, standing in for a tongue.
  arm.show(tl);
  arm.to(tl, { angle: 0.8, length: 70 }, seconds * 0.14, 'power1.inOut');
  arm.to(tl, { angle: -0.7, length: 96 }, seconds * 0.3, 'sine.inOut');

  burst(tl, ctx, 'heart', contactPoint(ctx), 120);
  burst(tl, ctx, 'sparkle', { ...contactPoint(ctx), y: contactPoint(ctx).y - 40 }, 90);

  arm.hide(tl, seconds * 0.14);
  tl.to(ctx.actor.root, { x: origin, duration: seconds * 0.26, ease: 'power2.out' }, '<');
  return tl;
}

/** Grabs and shakes the opponent. */
export function grab(ctx: PrimitiveContext, params: GrabParams = {}) {
  const seconds = duration(params.duration, 0.9);
  const dir = directionToEnemy(ctx);
  const origin = ctx.actor.root.x;
  const target = ctx.enemy.root.x - dir * (ctx.actor.width * 0.5 + ctx.enemy.width * 0.5);
  const arm = new LimbDriver(ctx.actor.arm, 1.2);

  const tl = gsap.timeline();
  tl.to(ctx.actor.root, { x: target, duration: seconds * 0.25, ease: 'power3.in' });
  arm.show(tl);
  arm.to(tl, { angle: 0, length: 100 }, seconds * 0.15, 'power3.out', '<');

  // Shake them about.
  const shakes = 4;
  for (let i = 0; i < shakes; i++) {
    const swing = (i % 2 === 0 ? 1 : -1) * 0.22;
    tl.to(ctx.enemy.body, { rotation: swing, duration: seconds * 0.09, ease: 'sine.inOut' });
    tl.to(ctx.enemy.root, { y: ctx.enemy.root.y - 14, duration: seconds * 0.045 }, '<');
    tl.to(ctx.enemy.root, { y: ctx.enemy.root.y, duration: seconds * 0.045 });
  }

  tl.to(ctx.enemy.body, { rotation: 0, duration: seconds * 0.12 });
  arm.hide(tl, seconds * 0.14, '<');
  tl.to(ctx.actor.root, { x: origin, duration: seconds * 0.2, ease: 'power2.out' }, '<');
  return tl;
}

/** Leaps up and stomps the ground, ringing a shockwave outward. */
export function stomp(ctx: PrimitiveContext, params: StompParams = {}) {
  const seconds = duration(params.duration, 0.8);
  const ground = ctx.actor.root.y;
  const leg = new LimbDriver(ctx.actor.leg, 1.9);

  const tl = gsap.timeline();
  tl.to(ctx.actor.body, { scaleY: 0.85, scaleX: 1.12, duration: seconds * 0.12 });
  tl.to(ctx.actor.root, { y: ground - 110, duration: seconds * 0.28, ease: 'power2.out' });
  tl.to(ctx.actor.body, { scaleY: 1.1, scaleX: 0.92, duration: seconds * 0.28 }, '<');

  leg.show(tl);
  leg.to(tl, { angle: 1.5, length: 120 }, seconds * 0.16, 'power4.in');
  tl.to(ctx.actor.root, { y: ground, duration: seconds * 0.16, ease: 'power4.in' }, '<');

  burst(tl, ctx, 'shockring', { x: ctx.actor.root.x, y: ground + 10 }, 260);
  tl.to(ctx.actor.body, { scaleY: 0.82, scaleX: 1.18, duration: seconds * 0.1 });
  tl.to(ctx.actor.body, { scaleY: 1, scaleX: 1, duration: seconds * 0.34, ease: 'elastic.out(1, 0.5)' });
  leg.hide(tl, seconds * 0.2, '<');
  return tl;
}
