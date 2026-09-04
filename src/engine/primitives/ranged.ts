import gsap from 'gsap';
import { spawnEffect, type EffectKind } from '../effects';
import { clamp, burst, contactPoint, directionToEnemy, duration, handPoint } from './util';
import { palette } from '../theme';
import type {
  BeamParams, PrimitiveContext, ProjectileParams, ShockwaveParams, SummonParams,
} from './types';

/**
 * Ranged and summoned attacks.
 *
 * These four moves carry most of the vocabulary's expressive range: rather than
 * a named move per idea, the AI picks a shape (thrown / beam / wave / dropped)
 * and a kind. "Throw the sun", "shoot fire" and "fling a rock" are all one
 * primitive with a different `kind`, which is what keeps an unbounded set of
 * player ideas inside a closed, safe vocabulary.
 */

const PROJECTILES = ['fire', 'sun', 'star', 'ice', 'heart', 'rock'] as const;
type ProjectileKind = (typeof PROJECTILES)[number];

/** Lobs something at the opponent. */
export function projectile(ctx: PrimitiveContext, params: ProjectileParams = {}) {
  const seconds = duration(params.duration, 0.9);
  const kind: ProjectileKind =
    params.kind && (PROJECTILES as readonly string[]).includes(params.kind)
      ? (params.kind as ProjectileKind)
      : 'fire';
  const size = clamp(params.size, 60, 320, kind === 'sun' ? 210 : 140);
  const arcHeight = clamp(params.arc, 0, 300, 90);
  const dir = directionToEnemy(ctx);

  const tl = gsap.timeline();

  // Wind-up.
  tl.to(ctx.actor.body, { rotation: -dir * 0.14, duration: seconds * 0.25, ease: 'power2.out' });

  tl.call(() => {
    const from = handPoint(ctx);
    const to = contactPoint(ctx);
    const sprite = spawnEffect(ctx.stage.effects, kind, { ...from, height: size, alpha: 0 });

    const flight = seconds * 0.5;
    gsap.to(sprite, { alpha: 1, duration: 0.08 });
    gsap.to(sprite, { x: to.x, duration: flight, ease: 'none' });
    // Two vertical tweens make the parabola; a single ease would only sag.
    gsap.to(sprite, { y: to.y - arcHeight, duration: flight / 2, ease: 'power2.out' });
    gsap.to(sprite, { y: to.y, duration: flight / 2, delay: flight / 2, ease: 'power2.in' });
    gsap.to(sprite, {
      rotation: dir * Math.PI * 2,
      duration: flight,
      ease: 'none',
      onComplete: () => sprite.destroy(),
    });
  });

  tl.to(ctx.actor.body, { rotation: dir * 0.16, duration: seconds * 0.2, ease: 'power3.in' });
  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.25, ease: 'power2.out' });

  burst(tl, ctx, 'impact', contactPoint(ctx), 190, `+=${seconds * 0.12}`);
  return tl;
}

const BEAM_TINTS: Record<string, number> = {
  energy: 0xffffff,        // the sprite's own aqua
  fire: palette.coral,
  ice: palette.sky,
  rainbow: palette.blossom,
};

/**
 * Charge-and-fire beam — the kamehameha shape.
 *
 * The beam sprite is anchored at its left edge and scaled along x to reach the
 * opponent, so one 256px texture stretches to any distance without smearing.
 */
export function beam(ctx: PrimitiveContext, params: BeamParams = {}) {
  const seconds = duration(params.duration, 1.6);
  const charge = clamp(params.chargeDuration, 0.1, 2, seconds * 0.45);
  const kind = params.kind && params.kind in BEAM_TINTS ? params.kind : 'energy';
  const thickness = clamp(params.thickness, 30, 220, 110);
  const dir = directionToEnemy(ctx);

  const tl = gsap.timeline();

  // Gather.
  tl.call(() => {
    const from = handPoint(ctx);
    const orb = spawnEffect(ctx.stage.effects, 'charge', { ...from, height: 40, alpha: 0.9 });
    orb.tint = BEAM_TINTS[kind]!;
    gsap.to(orb.scale, {
      x: (thickness * 1.3) / 200,
      y: (thickness * 1.3) / 200,
      duration: charge,
      ease: 'power2.in',
    });
    gsap.to(orb, { alpha: 0, duration: 0.2, delay: charge, onComplete: () => orb.destroy() });
  });
  tl.to(ctx.actor.body, { rotation: -dir * 0.1, scaleY: 1.06, duration: charge, ease: 'power2.in' });

  // Fire.
  tl.call(() => {
    const from = handPoint(ctx);
    const to = contactPoint(ctx);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);

    const sprite = spawnEffect(ctx.stage.effects, 'beam', { ...from, anchorX: 0, anchorY: 0.5 });
    sprite.tint = BEAM_TINTS[kind]!;
    sprite.rotation = Math.atan2(dy, dx);
    sprite.scale.set(0, thickness / sprite.texture.height);

    const hold = seconds - charge;
    gsap.to(sprite.scale, { x: distance / sprite.texture.width, duration: hold * 0.25, ease: 'power4.out' });
    gsap.to(sprite, {
      alpha: 0,
      duration: hold * 0.35,
      delay: hold * 0.65,
      onComplete: () => sprite.destroy(),
    });
  });

  tl.to(ctx.actor.body, { rotation: dir * 0.12, scaleY: 1, duration: (seconds - charge) * 0.2 });
  burst(tl, ctx, 'impact', contactPoint(ctx), 230, '<');
  tl.to(ctx.actor.body, { rotation: 0, duration: (seconds - charge) * 0.5, ease: 'power2.out' });
  return tl;
}

const SHOCKWAVES: Record<string, EffectKind> = {
  sound: 'soundwave',
  water: 'wave',
  ring: 'shockring',
};

/** An expanding wave that travels outward — shouting, singing, a tsunami. */
export function shockwave(ctx: PrimitiveContext, params: ShockwaveParams = {}) {
  const seconds = duration(params.duration, 1.1);
  const kind = params.kind && params.kind in SHOCKWAVES ? params.kind : 'ring';
  const sprite = SHOCKWAVES[kind]!;
  const intensity = clamp(params.intensity, 1, 10, 6);
  const dir = directionToEnemy(ctx);

  const tl = gsap.timeline();

  // The wind-up differs by kind: a shout leans in, a tsunami rears back.
  tl.to(ctx.actor.body, {
    scaleY: kind === 'water' ? 1.1 : 0.94,
    scaleX: kind === 'water' ? 0.94 : 1.08,
    rotation: -dir * 0.1,
    duration: seconds * 0.28,
    ease: 'power2.out',
  });

  tl.call(() => {
    const start = {
      x: ctx.actor.root.x + dir * ctx.actor.width * 0.4,
      y: ctx.actor.root.y - ctx.actor.height * (kind === 'water' ? 0.35 : 0.6),
    };
    const height = 120 + intensity * 26;
    const wave = spawnEffect(ctx.stage.effects, sprite, {
      ...start,
      height,
      flip: dir < 0,
      alpha: 0.95,
    });

    const travel = seconds * 0.6;
    gsap.to(wave, { x: ctx.enemy.root.x + dir * ctx.enemy.width * 0.4, duration: travel, ease: 'power1.out' });
    gsap.to(wave.scale, {
      x: wave.scale.x * 1.7,
      y: wave.scale.y * 1.7,
      duration: travel,
      ease: 'power1.out',
    });
    gsap.to(wave, { alpha: 0, duration: travel * 0.4, delay: travel * 0.6, onComplete: () => wave.destroy() });
  });

  tl.to(ctx.actor.body, {
    scaleY: 1, scaleX: 1, rotation: dir * 0.08,
    duration: seconds * 0.2,
    ease: 'power3.in',
  });
  tl.to(ctx.actor.body, { rotation: 0, duration: seconds * 0.3, ease: 'power2.out' });
  return tl;
}

const SUMMONS = ['drone', 'meteor', 'anvil', 'piano'] as const;

/** Drops something heavy on the opponent from off-screen. */
export function summon(ctx: PrimitiveContext, params: SummonParams = {}) {
  const seconds = duration(params.duration, 1.3);
  const kind = params.kind && (SUMMONS as readonly string[]).includes(params.kind)
    ? (params.kind as (typeof SUMMONS)[number])
    : 'anvil';
  const size = clamp(params.size, 80, 400, kind === 'drone' ? 200 : 230);
  const dir = directionToEnemy(ctx);

  const tl = gsap.timeline();

  // Call it in.
  tl.to(ctx.actor.body, { rotation: -dir * 0.12, y: -10, duration: seconds * 0.2, ease: 'power2.out' });
  tl.to(ctx.actor.body, { rotation: 0, y: 0, duration: seconds * 0.15 });

  tl.call(() => {
    const targetY = ctx.enemy.root.y - ctx.enemy.height * 0.85;
    const sprite = spawnEffect(ctx.stage.effects, kind, {
      x: ctx.enemy.root.x,
      y: -size,
      height: size,
      flip: dir < 0,
    });

    if (kind === 'drone') {
      // A drone hovers into place and lingers rather than falling.
      gsap.to(sprite, { y: targetY - 90, duration: seconds * 0.35, ease: 'power2.out' });
      gsap.to(sprite, {
        y: targetY - 74,
        duration: 0.35,
        repeat: 2,
        yoyo: true,
        delay: seconds * 0.35,
        ease: 'sine.inOut',
      });
      gsap.to(sprite, {
        alpha: 0,
        duration: 0.3,
        delay: seconds * 0.75,
        onComplete: () => sprite.destroy(),
      });
    } else {
      gsap.to(sprite, {
        y: targetY,
        duration: seconds * 0.4,
        ease: 'power3.in',
        onComplete: () => {
          gsap.to(sprite, { alpha: 0, duration: 0.25, delay: 0.12, onComplete: () => sprite.destroy() });
        },
      });
      gsap.to(sprite, { rotation: dir * 0.4, duration: seconds * 0.4, ease: 'none' });
    }
  });

  burst(tl, ctx, 'impact', contactPoint(ctx), 240, `+=${seconds * 0.4}`);
  return tl;
}
