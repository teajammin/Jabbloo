import gsap from 'gsap';
import { clamp, duration } from './util';
import type { IdleParams, PrimitiveContext, ShakeScreenParams } from './types';

/** Stage-level effects and rests. */

/**
 * Rattles the battlefield.
 *
 * Shakes `stage.world` rather than the canvas, so the overlay layer — health
 * bars, damage numbers — stays readable while everything else shudders.
 * Suppressed entirely when the viewer has asked for reduced motion, since
 * screen shake is a common migraine and nausea trigger.
 */
export function shake_screen(ctx: PrimitiveContext, params: ShakeScreenParams = {}) {
  const intensity = clamp(params.intensity, 1, 10, 5);
  const seconds = duration(params.duration, 0.5);
  const world = ctx.stage.world;

  const tl = gsap.timeline();

  if (prefersReducedMotion()) {
    tl.to({}, { duration: seconds });
    return tl;
  }

  const amplitude = intensity * 3;
  const shakes = Math.max(2, Math.round(seconds * 18));
  const step = seconds / shakes;

  for (let i = 0; i < shakes; i++) {
    // Decay towards zero so the shake settles instead of stopping dead.
    const falloff = 1 - i / shakes;
    tl.to(world, {
      x: (Math.random() * 2 - 1) * amplitude * falloff,
      y: (Math.random() * 2 - 1) * amplitude * falloff * 0.6,
      duration: step,
      ease: 'none',
    });
  }

  tl.to(world, { x: 0, y: 0, duration: step, ease: 'power2.out' });
  return tl;
}

/** A breathing pause. Also the fallback when a choreography step is unusable. */
export function idle(ctx: PrimitiveContext, params: IdleParams = {}) {
  const seconds = duration(params.duration, 0.5);
  const tl = gsap.timeline();
  tl.to(ctx.actor.body, {
    y: -6,
    duration: seconds / 2,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: 1,
  });
  return tl;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
