import gsap from 'gsap';
import type { PrimitiveContext } from './types';

/**
 * Parameter guards.
 *
 * Every value reaching a primitive originates from an AI response, so nothing
 * is trusted: values are clamped into ranges that stay watchable and keep a
 * move inside the 7-second budget. Bad input produces a dull move, never a
 * broken one.
 */

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Durations are the main budget risk — no single move may exceed 3s. */
export const DURATION_MIN = 0.1;
export const DURATION_MAX = 3;

export function duration(value: unknown, fallback: number): number {
  return clamp(value, DURATION_MIN, DURATION_MAX, fallback);
}

/** +1 if the enemy is to the actor's right, -1 if to the left. */
export function directionToEnemy(ctx: PrimitiveContext): 1 | -1 {
  return ctx.enemy.root.x >= ctx.actor.root.x ? 1 : -1;
}

/** How close two fighters may stand before they overlap. */
export function contactGap(ctx: PrimitiveContext): number {
  return ctx.actor.width * 0.5 + ctx.enemy.width * 0.5;
}

export const degrees = (value: number): number => (value * Math.PI) / 180;

// ---------------------------------------------------------------- limb driving

import type { Limb } from '../Limb';
import { spawnEffect, type EffectKind } from '../effects';
import type { Sprite } from 'pixi.js';

/**
 * Drives a Limb from a GSAP timeline.
 *
 * A Limb is drawn imperatively, so it can't be tweened directly. This holds one
 * mutable state object per limb per timeline: chained tweens mutate it in
 * sequence, so each starts from wherever the previous one finished — which is
 * what a naive `{...limb}` snapshot at build time would get wrong.
 */
export class LimbDriver {
  private readonly state: { angle: number; length: number };

  constructor(private readonly limb: Limb, startAngle = Math.PI / 2) {
    this.state = { angle: startAngle, length: 0 };
  }

  /** Reveals the limb at its starting pose. */
  show(tl: gsap.core.Timeline, position?: gsap.Position): this {
    tl.call(() => {
      this.limb.set(this.state.angle, this.state.length).show();
    }, undefined, position);
    return this;
  }

  to(
    tl: gsap.core.Timeline,
    to: { angle?: number; length?: number },
    duration: number,
    ease = 'power2.out',
    position?: gsap.Position,
  ): this {
    tl.to(
      this.state,
      {
        ...to,
        duration,
        ease,
        onUpdate: () => this.limb.set(this.state.angle, this.state.length),
      },
      position,
    );
    return this;
  }

  /** Retracts and hides. Always end a melee move with this. */
  hide(tl: gsap.core.Timeline, duration = 0.15, position?: gsap.Position): this {
    this.to(tl, { length: 0 }, duration, 'power2.in', position);
    tl.call(() => this.limb.hide());
    return this;
  }
}

// -------------------------------------------------------------------- effects

/** Where a strike lands: the near edge of the opponent, chest height. */
export function contactPoint(ctx: PrimitiveContext): { x: number; y: number } {
  const dir = directionToEnemy(ctx);
  return {
    x: ctx.enemy.root.x - dir * ctx.enemy.width * 0.35,
    y: ctx.enemy.root.y - ctx.enemy.height * 0.5,
  };
}

/** A fighter's hand position in stage coordinates. */
export function handPoint(ctx: PrimitiveContext): { x: number; y: number } {
  const global = ctx.actor.hand.getGlobalPosition();
  return ctx.stage.effects.toLocal(global);
}

/** Pops a burst at a point and cleans it up. Add to a timeline at the moment of contact. */
export function burst(
  tl: gsap.core.Timeline,
  ctx: PrimitiveContext,
  kind: EffectKind,
  at: { x: number; y: number },
  size = 200,
  position?: gsap.Position,
): void {
  tl.call(
    () => {
      const sprite = spawnEffect(ctx.stage.effects, kind, { ...at, height: size });
      sprite.rotation = Math.random() * Math.PI;
      gsap.fromTo(
        sprite.scale,
        { x: sprite.scale.x * 0.3, y: sprite.scale.y * 0.3 },
        { x: sprite.scale.x, y: sprite.scale.y, duration: 0.18, ease: 'back.out(3)' },
      );
      gsap.to(sprite, {
        alpha: 0,
        duration: 0.3,
        delay: 0.14,
        onComplete: () => sprite.destroy(),
      });
    },
    undefined,
    position,
  );
}

/** Fades and destroys an effect sprite at the end of its move. */
export function fadeOut(tl: gsap.core.Timeline, sprite: Sprite, duration = 0.25): void {
  tl.to(sprite, { alpha: 0, duration, onComplete: () => sprite.destroy() });
}
