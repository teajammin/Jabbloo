import gsap from 'gsap';
import { clamp, contactGap, directionToEnemy, duration } from './util';
import { GROUND_Y } from '../types';
import type {
  ChargeParams,
  JumpParams,
  MoveToParams,
  PrimitiveContext,
  RecoilParams,
} from './types';

/**
 * Moves that carry the whole fighter.
 *
 * All of these tween `actor.root`, the outermost container, so the body and its
 * weapon travel together.
 */

/** Walks to an absolute position, given as a fraction of stage width. */
export function move_to(ctx: PrimitiveContext, params: MoveToParams = {}) {
  const x = clamp(params.x, 0, 1, 0.5);
  const seconds = duration(params.duration, 0.6);
  const destination = ctx.stage.width * x;

  const tl = gsap.timeline();
  tl.to(ctx.actor.root, { x: destination, duration: seconds, ease: 'power2.inOut' });
  // A little bob, so travel reads as steps rather than a slide.
  tl.to(
    ctx.actor.body,
    { y: -8, duration: seconds / 4, ease: 'sine.inOut', yoyo: true, repeat: 3 },
    0,
  );
  return tl;
}

/** Rushes the opponent, stopping just short of overlapping them. */
export function charge(ctx: PrimitiveContext, params: ChargeParams = {}) {
  const seconds = duration(params.duration, 0.7);
  const dir = directionToEnemy(ctx);
  const destination = ctx.enemy.root.x - dir * contactGap(ctx);

  const tl = gsap.timeline();
  // Anticipation: pull back before committing. Sells the weight of the dash.
  tl.to(ctx.actor.root, {
    x: ctx.actor.root.x - dir * 26,
    duration: seconds * 0.25,
    ease: 'power2.out',
  });
  tl.to(ctx.actor.root, {
    x: destination,
    duration: seconds * 0.75,
    ease: 'power3.in',
  });
  tl.to(ctx.actor.body, { rotation: dir * 0.1, duration: seconds * 0.3 }, 0);
  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.2 });
  return tl;
}

/** Knocked backwards, away from the opponent, then recovers. */
export function recoil(ctx: PrimitiveContext, params: RecoilParams = {}) {
  const distance = clamp(params.distance, 0, 400, 90);
  const seconds = duration(params.duration, 0.45);
  const dir = directionToEnemy(ctx);
  const origin = ctx.actor.root.x;

  const tl = gsap.timeline();
  tl.to(ctx.actor.root, {
    x: origin - dir * distance,
    duration: seconds * 0.35,
    ease: 'power4.out',
  });
  tl.to(ctx.actor.body, { rotation: -dir * 0.22, duration: seconds * 0.35 }, 0);
  // Settle back part-way; a full return would undo the sense of impact.
  tl.to(ctx.actor.root, {
    x: origin - dir * distance * 0.35,
    duration: seconds * 0.65,
    ease: 'power2.out',
  });
  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.65 }, '<');
  return tl;
}

/** Hops in place, or forwards toward the opponent. */
export function jump(ctx: PrimitiveContext, params: JumpParams = {}) {
  const height = clamp(params.height, 0, 400, 140);
  const seconds = duration(params.duration, 0.7);
  const forward = params.forward === true;
  const ground = ctx.stage.height * GROUND_Y;
  const dir = directionToEnemy(ctx);

  const tl = gsap.timeline();
  // Crouch, leap, land — squash and stretch keeps it bouncy rather than floaty.
  tl.to(ctx.actor.body, { scaleY: 0.86, scaleX: 1.1, duration: seconds * 0.15 });
  tl.to(ctx.actor.body, { scaleY: 1.08, scaleX: 0.94, duration: seconds * 0.2 });
  tl.to(
    ctx.actor.root,
    { y: ground - height, duration: seconds * 0.4, ease: 'power2.out' },
    '<',
  );
  tl.to(ctx.actor.root, { y: ground, duration: seconds * 0.4, ease: 'power2.in' });
  tl.to(ctx.actor.body, { scaleY: 0.9, scaleX: 1.08, duration: seconds * 0.1 });
  tl.to(ctx.actor.body, { scaleY: 1, scaleX: 1, duration: seconds * 0.15 });

  if (forward) {
    const destination = ctx.enemy.root.x - dir * contactGap(ctx);
    tl.to(
      ctx.actor.root,
      { x: destination, duration: seconds * 0.8, ease: 'power1.inOut' },
      seconds * 0.15,
    );
  }
  return tl;
}
