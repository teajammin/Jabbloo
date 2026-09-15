/**
 * Keeping ranged attacks at range — and only those.
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
 *
 * The narrowness matters as much as the rule. A first pass treated every
 * effect that leaves the body as ranged — shockwaves, summons, a projectile
 * anywhere in the move — and stopped fighters closing at all: a charge into a
 * ground slam had its charge removed, and the slam happened across the room.
 * Closing the distance is most of this game. Only a move that *opens* with
 * something crossing the gap keeps its distance.
 */

/** Moves that carry the fighter toward their opponent. */
const APPROACH = new Set(['move_to', 'dash', 'charge', 'step', 'lunge']);

/**
 * Moves that cross the gap, and so need the gap to exist.
 *
 * Deliberately short. A shockwave can be a shout from across the arena or a
 * fist into the ground at someone's feet; a summon falls out of the sky
 * wherever its target is standing. Neither says anything about where the
 * attacker should be, so neither belongs here.
 */
const RANGED = new Set(['projectile', 'beam', 'throw']);

/**
 * Moves that only make sense within arm's reach.
 *
 * If one of these comes first, the fighter is meant to be close, and whatever
 * walked them over is doing its job — even if something is thrown or fired
 * later in the same move.
 */
const MELEE = new Set([
  'swing', 'slam', 'punch', 'kick', 'headbutt', 'bite', 'lick', 'grab',
  'stomp', 'spin_weapon', 'inhale',
]);

interface Step {
  move?: unknown;
  on?: unknown;
  params?: unknown;
}

/**
 * Drops any approach the attacker makes before a move that opens at range.
 *
 * Only before it: closing in *afterwards* is a fair follow-up — fire, then
 * rush them while they are reeling — and that reads fine.
 *
 * Anything that is not a recognisable list of steps is handed straight back;
 * validation proper happens downstream, and this has no business deciding
 * what a malformed choreography means.
 */
/**
 * Reactions belong to whoever they happen to.
 *
 * `sicken`, `dizzy` and `knockdown` describe a state somebody is put into, and
 * the prompt says in capitals that they are used on the enemy. The model still
 * leaves the `on` off, and a step with no `on` runs on the attacker — so a
 * player who wrote "poison them" watched their own fighter turn green and
 * stagger while their opponent stood there untouched. Exactly backwards, and
 * the funniest possible way to lose.
 *
 * Only filled in when it is missing. A move that deliberately says `"on":
 * "self"` — poisoning yourself for power is a real thing somebody will write —
 * is left alone.
 */
const REACTIONS = new Set(['sicken', 'dizzy', 'knockdown']);

export function aimReactionsAtTheEnemy(choreography: unknown): unknown {
  if (typeof choreography !== 'object' || choreography === null) return choreography;

  const steps = (choreography as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return choreography;

  let changed = false;
  const fixed = steps.map((step) => {
    if (typeof step !== 'object' || step === null) return step;
    const named = step as { move?: unknown; on?: unknown };
    if (typeof named.move !== 'string' || !REACTIONS.has(named.move)) return step;
    if (named.on !== undefined) return step;
    changed = true;
    return { ...named, on: 'enemy' };
  });

  return changed ? { ...(choreography as object), steps: fixed } : choreography;
}

/**
 * Walks a fighter in when the move needs them close.
 *
 * The mirror of the rule below, and the half that was missing. Fighters start
 * a third of the arena apart, and a punch lunges twenty-six pixels — so a jab
 * or an uppercut with no approach in front of it was thrown at nothing, while
 * the impact appeared over by the opponent. The choreographer supplies an
 * approach most of the time and simply forgets it the rest, which is not a
 * thing worth asking twice for.
 *
 * `charge` is what gets used, because it ends at striking range by definition
 * rather than at a guessed coordinate.
 */
export function closeInForMelee(choreography: unknown): unknown {
  if (typeof choreography !== 'object' || choreography === null) return choreography;

  const steps = (choreography as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return choreography;

  const nameOf = (step: unknown): string =>
    typeof step === 'object' && step !== null && typeof (step as Step).move === 'string'
      ? (step as Step).move as string
      : '';
  const isOwn = (step: unknown): boolean =>
    typeof step === 'object' && step !== null && (step as Step).on !== 'enemy';

  const firstAttack = steps.findIndex((step) => {
    const name = nameOf(step);
    return isOwn(step) && (RANGED.has(name) || MELEE.has(name));
  });

  // Nothing to walk to, or the move opens at range on purpose.
  if (firstAttack < 0 || !MELEE.has(nameOf(steps[firstAttack]))) return choreography;

  // Already on their way.
  const approaches = steps
    .slice(0, firstAttack)
    .some((step) => APPROACH.has(nameOf(step)) && isOwn(step));
  if (approaches) return choreography;

  const walk = { move: 'charge', params: { duration: 0.6 } };
  return { ...(choreography as object), steps: [...steps.slice(0, firstAttack), walk, ...steps.slice(firstAttack)] };
}

export function keepRangedAtRange(choreography: unknown): unknown {
  if (typeof choreography !== 'object' || choreography === null) return choreography;

  const steps = (choreography as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return choreography;

  const nameOf = (step: unknown): string =>
    typeof step === 'object' && step !== null && typeof (step as Step).move === 'string'
      ? (step as Step).move as string
      : '';

  // Only the attacker's own moves count. A step aimed at the enemy that
  // happens to share a name is something being done *to* them.
  const isOwn = (step: unknown): boolean =>
    typeof step === 'object' && step !== null && (step as Step).on !== 'enemy';

  // The first thing that actually attacks decides how this move is fought.
  const firstAttack = steps.findIndex((step) => {
    const name = nameOf(step);
    return isOwn(step) && (RANGED.has(name) || MELEE.has(name));
  });
  if (firstAttack <= 0) return choreography;
  if (!RANGED.has(nameOf(steps[firstAttack]))) return choreography;

  const kept = steps.filter((step, index) =>
    index >= firstAttack || !(APPROACH.has(nameOf(step)) && isOwn(step)));

  if (kept.length === steps.length) return choreography;
  return { ...(choreography as object), steps: kept };
}
