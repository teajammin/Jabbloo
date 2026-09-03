import gsap from 'gsap';
import { clamp, degrees, directionToEnemy, duration } from './util';
import type {
  PrimitiveContext,
  SlamParams,
  SpinWeaponParams,
  SwingParams,
  SwingDirection,
  ThrowParams,
} from './types';

/**
 * Moves driven by the weapon.
 *
 * These rotate `actor.hand` rather than the weapon sprite, so the weapon sweeps
 * around the grip like a held object instead of spinning about its own middle.
 * The fighter's mirroring is inherited, so a "down" swing reads correctly on
 * both sides of the stage without special-casing.
 */

/** Twirls the weapon a whole number of turns. */
export function spin_weapon(ctx: PrimitiveContext, params: SpinWeaponParams = {}) {
  const rotations = clamp(params.rotations, -6, 6, 2);
  const seconds = duration(params.duration, 0.8);

  const tl = gsap.timeline();
  tl.to(ctx.actor.hand, {
    rotation: `+=${rotations * Math.PI * 2}`,
    duration: seconds,
    ease: 'power1.inOut',
  });
  return tl;
}

/** Where a swing starts and finishes, in degrees around the grip. */
const SWING_ARCS: Record<SwingDirection, (arc: number) => [number, number]> = {
  down: (arc) => [-arc / 2, arc / 2],
  up: (arc) => [arc / 2, -arc / 2],
  right: (arc) => [-arc * 0.35, arc * 0.65],
  left: (arc) => [arc * 0.35, -arc * 0.65],
};

/** Winds up, then sweeps the weapon through an arc. */
export function swing(ctx: PrimitiveContext, params: SwingParams = {}) {
  const arc = clamp(params.arc, 10, 360, 120);
  const seconds = duration(params.duration, 0.6);
  const direction: SwingDirection =
    params.direction && params.direction in SWING_ARCS ? params.direction : 'down';
  const [from, to] = SWING_ARCS[direction](arc);
  const dir = directionToEnemy(ctx);

  const tl = gsap.timeline();
  // Wind-up is slow, the strike is fast — the contrast is what sells a hit.
  tl.to(ctx.actor.hand, {
    rotation: degrees(from),
    duration: seconds * 0.4,
    ease: 'power2.out',
  });
  tl.to(ctx.actor.body, { rotation: -dir * 0.08, duration: seconds * 0.4 }, 0);
  tl.to(ctx.actor.hand, {
    rotation: degrees(to),
    duration: seconds * 0.25,
    ease: 'power4.in',
  });
  tl.to(ctx.actor.body, { rotation: dir * 0.12, duration: seconds * 0.25 }, '<');
  // Recover to neutral so the next step starts from a known pose.
  tl.to(ctx.actor.hand, { rotation: 0, duration: seconds * 0.35, ease: 'power2.out' });
  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.35 }, '<');
  return tl;
}

/** A heavy overhead or forward smash. */
export function slam(ctx: PrimitiveContext, params: SlamParams = {}) {
  const seconds = duration(params.duration, 0.7);
  const forward = params.direction === 'forward';
  const dir = directionToEnemy(ctx);

  const tl = gsap.timeline();
  // Raise high and hang for a beat — anticipation is most of the weight.
  tl.to(ctx.actor.hand, {
    rotation: degrees(forward ? -70 : -110),
    duration: seconds * 0.4,
    ease: 'power2.out',
  });
  tl.to(ctx.actor.body, { y: -14, duration: seconds * 0.4 }, 0);
  tl.to(ctx.actor.hand, {
    rotation: degrees(forward ? 20 : 12),
    duration: seconds * 0.18,
    ease: 'power4.in',
  });
  tl.to(ctx.actor.body, { y: 10, duration: seconds * 0.18 }, '<');
  if (forward) {
    tl.to(ctx.actor.root, { x: `+=${dir * 30}`, duration: seconds * 0.18 }, '<');
  }
  // Bounce off the impact, then settle.
  tl.to(ctx.actor.body, { y: 0, duration: seconds * 0.42, ease: 'elastic.out(1, 0.5)' });
  tl.to(ctx.actor.hand, { rotation: 0, duration: seconds * 0.42, ease: 'power2.out' }, '<');
  return tl;
}

/** Hurls the weapon at the opponent, optionally boomeranging back. */
export function throw_(ctx: PrimitiveContext, params: ThrowParams = {}) {
  const seconds = duration(params.duration, 1);
  const returnAfter = params.returnAfter !== false; // keeps the fighter armed by default
  const dir = directionToEnemy(ctx);
  const weapon = ctx.actor.weapon;

  const tl = gsap.timeline();

  // The weapon must fly in stage coordinates, or it would be dragged along by
  // the body that threw it. Detach on start, restore however the tween ends —
  // including if it is interrupted, so the fighter can never end up disarmed.
  tl.call(() => ctx.actor.detachWeapon(ctx.stage.fighters));

  const targetX = ctx.enemy.root.x;
  const targetY = ctx.enemy.root.y - ctx.enemy.height * 0.5;
  const outbound = returnAfter ? seconds * 0.5 : seconds;

  tl.to(weapon, {
    x: targetX,
    y: targetY,
    rotation: `+=${dir * Math.PI * 4}`,
    duration: outbound,
    ease: 'power1.out',
  });

  if (returnAfter) {
    const handPoint = ctx.stage.fighters.toLocal(ctx.actor.hand.getGlobalPosition());
    tl.to(weapon, {
      x: handPoint.x,
      y: handPoint.y,
      rotation: `+=${dir * Math.PI * 4}`,
      duration: seconds * 0.5,
      ease: 'power1.in',
    });
  }

  tl.call(() => ctx.actor.reattachWeapon());
  tl.eventCallback('onInterrupt', () => ctx.actor.reattachWeapon());
  return tl;
}
