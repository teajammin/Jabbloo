/**
 * The strategy layer's arithmetic.
 *
 * Both players choose a side to guard and a side to attack before either sees
 * anything, and what those choices are worth is pure arithmetic over numbers
 * between nought and a hundred. That is exactly the kind of rule where a
 * mistake does not throw: a wrong order of operations produces a believable
 * figure, the fight plays out, and the only symptom is that shields feel
 * useless or swords feel unbeatable — which nobody can debug from a party.
 */
import {
  SIDES, OFFENSIVE_BONUS, BLOCKED_DAMAGE, MAX_SCORE,
  blocked, guardsFor, damageFor, type Move, type Side,
} from '../src/shared/protocol';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const move = (attack: Side, defend: Side[]): Move =>
  ({ weapon: 0, prompt: '', attack, defend });

// --- guessing ---------------------------------------------------------------

check('a guard on the attacked side catches it',
  blocked(move('left', ['top']), move('right', ['left'])));
check('a guard anywhere else does not',
  !blocked(move('left', ['top']), move('right', ['right'])));
check('either of a defensive weapon\'s two guards will do',
  blocked(move('bottom', ['top']), move('right', ['left', 'bottom'])));
check('a move with no opponent is never blocked', !blocked(move('left', ['left']), undefined));

check('an offensive weapon guards one side', guardsFor('offensive') === 1);
check('a defensive weapon guards two', guardsFor('defensive') === 2);
check('a weapon from before the choice existed guards one', guardsFor(undefined) === 1);

// --- what a blow is worth ---------------------------------------------------

const plain = { scored: 20, offensive: false, guarded: false, multiplier: 1 };

check('an unblocked defensive weapon deals what it scored',
  damageFor(plain) === 20);
check(`an offensive weapon adds ${OFFENSIVE_BONUS}`,
  damageFor({ ...plain, offensive: true }) === 28);
check('a guard halves it',
  damageFor({ ...plain, guarded: true }) === 10);

/*
 * The bonus is inside what the guard halves.
 *
 * The other reading — bonus added after the halving — makes an offensive
 * weapon strictly better than a defensive one in every case, because the one
 * thing a guard is for would no longer touch the advantage it is up against.
 */
check('a guard halves the bonus with it',
  damageFor({ ...plain, offensive: true, guarded: true }) === 14,
  String(damageFor({ ...plain, offensive: true, guarded: true })));

check('the final round doubles whatever is left',
  damageFor({ ...plain, offensive: true, guarded: true, multiplier: 2 }) === 28);

// --- the shape of the bargain ----------------------------------------------

/*
 * What each weapon is actually worth, in the currency the fight is settled in.
 *
 * The win condition is least damage TAKEN, not most dealt — so the offensive
 * weapon's bonus does not win a fight directly, it only shortens the other
 * one's health bar. What decides a round is how much gets through your own
 * guard, and that depends on how many sides you cover.
 *
 * Measured against the same opponent — an offensive weapon guarding one side
 * — so the only variable is which weapon you took.
 */
const incoming = damageFor({
  scored: MAX_SCORE / 2, offensive: true, guarded: false, multiplier: 1,
});
/** What gets through when you guard `guards` of the four sides. */
const taken = (guards: number) => {
  const caught = guards / SIDES.length;
  return incoming * (1 - caught) + incoming * BLOCKED_DAMAGE * caught;
};

const takenWithSword = taken(guardsFor('offensive'));
const takenWithShield = taken(guardsFor('defensive'));

check('a defensive weapon takes less than an offensive one',
  takenWithShield < takenWithSword,
  `sword ${takenWithSword.toFixed(1)}, shield ${takenWithShield.toFixed(1)}`);

/*
 * And by a margin worth choosing over, but not one that settles it.
 *
 * Too small and the second guard is decoration; too large and nobody would
 * ever draw a sword. A tenth to a third of a blow is the band where both
 * answers are defensible.
 */
const edge = (takenWithSword - takenWithShield) / incoming;
check('by a margin that makes it a choice rather than an answer',
  edge > 0.08 && edge < 0.35,
  `the shield saves ${(edge * 100).toFixed(0)}% of a blow`);

console.log(`\n  offensive weapon: deals +${OFFENSIVE_BONUS}, takes ${takenWithSword.toFixed(1)} per blow`);
console.log(`  defensive weapon: no bonus,  takes ${takenWithShield.toFixed(1)} per blow`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
