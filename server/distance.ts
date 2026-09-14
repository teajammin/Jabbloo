/**
 * Keeping ranged attacks at range.
 *
 * The choreographer is told, in as many words, that a shot or a throw is made
 * from where the attacker stands. It walks in anyway — near enough every time,
 * with a `move_to` or a `charge` before the bullet leaves the barrel. The
 * result is a player who wrote "shoot them" watching their fighter stroll
 * across the arena and fire point blank, which is the whole difference between
 * shooting and hitting.
 *
 * So it is enforced here rather than asked for. Instructions the model ignores
 * this reliably are not instructions, and this is cheap, deterministic, and
 * applies equally to the fallback model and to anything either of them
 * invents on a bad day.
 */

/** Moves that carry the fighter toward their opponent. */
const APPROACH = new Set(['move_to', 'dash', 'charge', 'step', 'lunge']);

/** Moves that put something across the gap, and so need the gap to exist. */
const RANGED = new Set(['projectile', 'beam', 'throw', 'shockwave', 'summon']);

interface Step {
  move?: unknown;
  on?: unknown;
  params?: unknown;
}

/**
 * Drops any approach the attacker makes before their first ranged move.
 *
 * Only before it: closing in *afterwards* is a fair follow-up — fire, then
 * rush them while they are reeling — and that reads fine. It is the walk
 * before the shot that spoils it.
 *
 * Anything that is not a recognisable list of steps is handed straight back;
 * validation proper happens downstream, and this has no business deciding
 * what a malformed choreography means.
 */
export function keepRangedAtRange(choreography: unknown): unknown {
  if (typeof choreography !== 'object' || choreography === null) return choreography;

  const steps = (choreography as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return choreography;

  const nameOf = (step: unknown): string =>
    typeof step === 'object' && step !== null && typeof (step as Step).move === 'string'
      ? (step as Step).move as string
      : '';

  // Only the attacker's own approach counts. A step aimed at the enemy that
  // happens to share a name is something being done *to* them.
  const isOwn = (step: unknown): boolean =>
    typeof step === 'object' && step !== null && (step as Step).on !== 'enemy';

  const firstRanged = steps.findIndex((step) => RANGED.has(nameOf(step)) && isOwn(step));
  if (firstRanged <= 0) return choreography;

  const kept = steps.filter((step, index) =>
    index >= firstRanged || !(APPROACH.has(nameOf(step)) && isOwn(step)));

  if (kept.length === steps.length) return choreography;
  return { ...(choreography as object), steps: kept };
}
