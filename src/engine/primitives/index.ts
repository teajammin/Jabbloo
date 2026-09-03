import { charge, jump, move_to, recoil } from './locomotion';
import { slam, spin_weapon, swing, throw_ } from './weapon';
import { idle, shake_screen } from './effects';
import type { PrimitiveContext, PrimitiveName, PrimitiveParams, Step } from './types';

/**
 * The primitive registry.
 *
 * This is the complete vocabulary available to the AI choreographer — it may
 * call these and nothing else. Keeping the list closed is what makes an
 * arbitrary player prompt safe to animate: an unknown move cannot reach the
 * canvas, it falls back to a default swing.
 */
export const primitives = {
  move_to,
  charge,
  recoil,
  spin_weapon,
  swing,
  slam,
  throw: throw_, // `throw` is a reserved word, so the implementation is throw_
  jump,
  shake_screen,
  idle,
} as const;

export const PRIMITIVE_NAMES = Object.keys(primitives) as PrimitiveName[];

export function isPrimitiveName(value: unknown): value is PrimitiveName {
  return typeof value === 'string' && value in primitives;
}

/**
 * Builds the timeline for one step.
 *
 * Unknown moves become a swing rather than an error — the brief's rule that a
 * request the AI cannot handle just bonks the opponent like a sword.
 */
export function createStep(ctx: PrimitiveContext, step: Step): gsap.core.Timeline {
  const name = isPrimitiveName(step.move) ? step.move : 'swing';
  const primitive = primitives[name] as (
    ctx: PrimitiveContext,
    params: PrimitiveParams[typeof name],
  ) => gsap.core.Timeline;
  return primitive(ctx, (step.params ?? {}) as PrimitiveParams[typeof name]);
}

export * from './types';
export { DURATION_MAX, DURATION_MIN } from './util';
