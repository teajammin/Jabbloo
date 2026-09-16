import gsap from 'gsap';
import { spawnEffect, despawnEffect, type EffectKind } from '../effects';
import { clamp, directionToEnemy, duration } from './util';
import type {
  DizzyParams, GrowParams, InhaleParams, KnockdownParams, PrimitiveContext, ShrinkParams,
  SickenParams, AfflictionKind,
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
    gsap.to(wind, { alpha: 0, duration: seconds * 0.5, onComplete: () => despawnEffect(wind) });
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
    gsap.to(spark, { alpha: 0, duration: 0.5, onComplete: () => despawnEffect(spark) });
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
    gsap.to(stars, { alpha: 0, duration: 0.4, delay: 0.7, onComplete: () => despawnEffect(stars) });
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
    gsap.to(stars, { alpha: 0, duration: 0.3, delay: seconds - 0.3, onComplete: () => despawnEffect(stars) });
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

/**
 * What each affliction looks like.
 *
 * A colour and something rising off them, so a state that outlasts the blow
 * can be read from across a room with no text on screen: green for poison,
 * pink hearts for love, violet spirals for a curse, blue for frozen. The
 * player wrote the word; this is the room being told what it meant.
 */
const AFFLICTIONS: Record<AfflictionKind, {
  tint: number; mark: EffectKind; tintMark: boolean;
}> = {
  poison: { tint: 0x8fd48a, mark: 'bubble', tintMark: true },
  burn: { tint: 0xff8a5c, mark: 'fire', tintMark: false },
  curse: { tint: 0xb07bff, mark: 'dizzy', tintMark: true },
  love: { tint: 0xff9ec7, mark: 'hearts', tintMark: false },
  hypnotised: { tint: 0xc79bff, mark: 'dizzy', tintMark: true },
  frozen: { tint: 0x9fd8f5, mark: 'snowflake', tintMark: false },
  shocked: { tint: 0xffe37a, mark: 'bolt', tintMark: false },
  stink: { tint: 0xa9c47a, mark: 'stink', tintMark: false },
  confused: { tint: 0xd9c7f5, mark: 'confused', tintMark: false },
  drunk: { tint: 0xe0b877, mark: 'bubble', tintMark: true },
};

/**
 * Poisons, sickens, infects — whatever the player called it.
 *
 * Applied to the fighter it happens to, like dizzy and knockdown: the move
 * that causes it says `"on": "enemy"`.
 *
 * Lingering harm was the one kind of attack with nothing to show for itself. A
 * player who wrote "poison them" got a swing and a number, and the room had no
 * way to tell that the next round's damage was their doing. This puts it on
 * the body: the colour drains toward something sickly, and it keeps bubbling
 * long enough to be read as a state rather than a hit.
 *
 * The tint is left behind on purpose. It is cleared when a fighter resets, so
 * it lasts the exchange and does not follow them into the next one.
 */
export function sicken(ctx: PrimitiveContext, params: SickenParams = {}) {
  const seconds = duration(params.duration, 1.2);
  const strength = clamp(params.intensity, 1, 10, 6);
  const look = AFFLICTIONS[params.kind as AfflictionKind] ?? AFFLICTIONS.poison;
  const { tint, mark } = look;

  const tl = gsap.timeline();

  // The colour goes first, because it is what says "something is wrong with
  // them" before any of the rest of it has had time to read.
  tl.call(() => { ctx.actor.setTint(tint); });
  tl.fromTo(ctx.actor.body.scale, { y: 1 }, {
    y: 0.94, duration: seconds * 0.18, ease: 'power2.out',
  });

  // Marks rising off them, staggered so it reads as something ongoing rather
  // than one puff.
  const marks = Math.min(6, 2 + Math.round(strength / 2));
  for (let i = 0; i < marks; i++) {
    tl.call(() => {
      const floater = spawnEffect(ctx.stage.effects, mark, {
        x: ctx.actor.root.x + (Math.random() - 0.5) * ctx.actor.width * 0.7,
        y: ctx.actor.root.y - ctx.actor.height * (0.45 + Math.random() * 0.4),
        height: 40 + strength * 5,
        alpha: 0.9,
      });
      // Hearts and stars carry their own colour; a cloud needs tinting.
      if (look.tintMark) floater.tint = tint;
      gsap.to(floater, {
        y: floater.y - 90 - strength * 8,
        x: floater.x + (Math.random() - 0.5) * 40,
        alpha: 0,
        duration: 0.9,
        ease: 'power1.out',
        onComplete: () => despawnEffect(floater),
      });
    }, undefined, seconds * 0.15 + i * (seconds * 0.6 / marks));
  }

  // A queasy sway underneath it all.
  const sways = 3;
  const each = (seconds * 0.7) / (sways * 2);
  for (let i = 0; i < sways; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    tl.to(ctx.actor.body, { rotation: side * 0.09, duration: each, ease: 'sine.inOut' });
    tl.to(ctx.actor.body, { rotation: 0, duration: each, ease: 'sine.inOut' });
  }
  tl.to(ctx.actor.body.scale, { y: 1, duration: seconds * 0.2, ease: 'power2.out' });

  return tl;
}
