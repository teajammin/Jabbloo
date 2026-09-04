import gsap from 'gsap';
import { createStep, isPrimitiveName } from './primitives';
import type { PrimitiveContext, Step } from './primitives';

/**
 * Choreography playback.
 *
 * Takes a list of steps — normally straight from the AI — sequences them into
 * one timeline, and guarantees the whole thing finishes inside the budget.
 */

/** The brief's hard ceiling: no move may take longer than this. */
export const MAX_CHOREOGRAPHY_SECONDS = 7;

/** Beyond this, a choreography is padding rather than choreography. */
export const MAX_STEPS = 12;

/**
 * The only moves that may be performed by the opponent.
 *
 * Models over-apply `on: "enemy"` — asked to inhale someone, they mark the
 * inhale itself as the opponent's, which plays as the victim swallowing the
 * attacker. Attacks are always performed by whoever is taking the turn; only
 * consequences belong to the other fighter. Enforced here rather than trusted
 * to the prompt, because it inverts the meaning of a move when it goes wrong.
 */
const REACTION_MOVES = new Set(['knockdown', 'dizzy', 'recoil', 'idle']);

export interface Choreography {
  steps: Step[];
}

/**
 * The fallback when a prompt cannot be interpreted.
 *
 * The brief: if the AI can't understand the movement, the weapon just hits the
 * other player like a swinging axe. Charge, swing, impact.
 */
export const DEFAULT_CHOREOGRAPHY: Choreography = {
  steps: [
    { move: 'charge', params: { target: 'enemy', duration: 0.8 } },
    { move: 'swing', params: { direction: 'down', arc: 150, duration: 0.7 } },
    { move: 'shake_screen', params: { intensity: 6, duration: 0.4 } },
    { move: 'recoil', params: { distance: 60, duration: 0.5 } },
  ],
};

export interface PlaybackOptions {
  /** Override the ceiling. Only useful for tests. */
  maxSeconds?: number;
  /** Reset both fighters to their marks before playing. Defaults to true. */
  resetFirst?: boolean;
  /** Fires as each step begins — for captions, sound cues, damage timing. */
  onStep?: (index: number, step: Step) => void;
}

export interface Playback {
  timeline: gsap.core.Timeline;
  /** Resolves when playback finishes, or when stopped. Never rejects. */
  finished: Promise<void>;
  /** Total run time the steps asked for, before any compression. */
  requestedSeconds: number;
  /** What it will actually take — never above the ceiling. */
  actualSeconds: number;
  /** True when the choreography overran and was sped up to fit. */
  compressed: boolean;
  stop(): void;
}

/**
 * Coerces arbitrary JSON into a playable choreography.
 *
 * Written defensively because the input is a language model's output: it may be
 * an array, an object, wrapped in prose, or malformed. Anything unusable
 * becomes the default swing rather than an error — a player always sees a
 * fight, never a stack trace.
 */
export function parseChoreography(input: unknown): Choreography {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'object' && input !== null && Array.isArray((input as any).steps)
      ? (input as { steps: unknown[] }).steps
      : null;

  if (!raw) return DEFAULT_CHOREOGRAPHY;

  const steps: Step[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const move = (entry as { move?: unknown }).move;
    if (!isPrimitiveName(move)) continue;
    const params = (entry as { params?: unknown }).params;
    const on = (entry as { on?: unknown }).on;
    const performedByEnemy = on === 'enemy' && REACTION_MOVES.has(move);
    steps.push({
      move,
      ...(performedByEnemy ? { on: 'enemy' as const } : {}),
      params: typeof params === 'object' && params !== null ? params : {},
    } as Step);
    if (steps.length >= MAX_STEPS) break;
  }

  return steps.length > 0 ? { steps } : DEFAULT_CHOREOGRAPHY;
}

/**
 * Plays a choreography.
 *
 * Steps run in sequence. If they collectively overrun the ceiling the whole
 * timeline is time-scaled to fit, rather than truncated — the fight keeps its
 * shape and simply reads as faster, where cutting it off would drop the payoff
 * and leave fighters stranded mid-pose.
 */
export function playChoreography(
  ctx: PrimitiveContext,
  choreography: Choreography,
  options: PlaybackOptions = {},
): Playback {
  const { maxSeconds = MAX_CHOREOGRAPHY_SECONDS, resetFirst = true, onStep } = options;

  if (resetFirst) ctx.stage.reset();

  const master = gsap.timeline({ paused: true });

  choreography.steps.forEach((step, index) => {
    if (onStep) master.call(() => onStep(index, step));
    master.add(createStep(ctx, step));
  });

  const requestedSeconds = master.duration();
  const compressed = requestedSeconds > maxSeconds;
  if (compressed && requestedSeconds > 0) {
    master.timeScale(requestedSeconds / maxSeconds);
  }

  let settle: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });

  master.eventCallback('onComplete', () => settle());
  master.play();

  return {
    timeline: master,
    finished,
    requestedSeconds,
    actualSeconds: compressed ? maxSeconds : requestedSeconds,
    compressed,
    stop() {
      master.kill();
      // Resolve rather than leaving an await hanging forever.
      settle();
    },
  };
}
