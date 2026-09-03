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
