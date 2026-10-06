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
  SIDES, OFFENSIVE_BONUS, MAX_SCORE,
  caughtFraction, fullyBlocked, guardsFor, attacksFor, damageFor,
  type Move, type Side,
} from '../src/shared/protocol';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const move = (attack: Side[], defend: Side[]): Move =>
  ({ weapon: 0, prompt: '', attack, defend });

// --- guessing ---------------------------------------------------------------

check('a guard on the struck side catches all of it',
  caughtFraction(move(['left'], ['top']), move(['right'], ['left'])) === 1);
check('a guard anywhere else catches none of it',
  caughtFraction(move(['left'], ['top']), move(['right'], ['right'])) === 0);
check('either of a defensive weapon\'s two guards will do',
  caughtFraction(move(['bottom'], ['top']), move(['right'], ['left', 'bottom'])) === 1);
check('a move with no opponent is never caught',
  caughtFraction(move(['left'], ['left']), undefined) === 0);

/*
 * The partial catch, which is what striking in two places is for.
 *
 * A defender covering one of the two places a blow lands has stopped half of
 * it — not all of it, which would make a second strike a liability, and not
 * none of it, which would make a guard pointless against the weapon it most
 * needs to stop.
 */
check('covering one of two struck sides catches half',
  caughtFraction(move(['left', 'top'], ['bottom']), move(['right'], ['top'])) === 0.5);
check('covering both catches all of it',
  caughtFraction(move(['left', 'top'], ['bottom']), move(['right'], ['top', 'left'])) === 1);
check('covering neither catches none',
  caughtFraction(move(['left', 'top'], ['bottom']), move(['right'], ['right'])) === 0);

check('only a full catch reads as a miss',
  fullyBlocked(move(['left', 'top'], []), move(['right'], ['top', 'left'])));
check('a half-caught blow is still a hit',
  !fullyBlocked(move(['left', 'top'], []), move(['right'], ['top'])));

check('an offensive weapon guards one side', guardsFor('offensive') === 1);
check('a defensive weapon guards two', guardsFor('defensive') === 2);
check('a weapon from before the choice existed guards one', guardsFor(undefined) === 1);
check('an offensive weapon strikes two sides', attacksFor('offensive') === 2);
check('a defensive weapon strikes one', attacksFor('defensive') === 1);

// --- what a blow is worth ---------------------------------------------------

const plain = { scored: 20, offensive: false, caught: 0, multiplier: 1 };

check('an unblocked defensive weapon deals what it scored',
  damageFor(plain) === 20);
check(`an offensive weapon adds ${OFFENSIVE_BONUS}`,
  damageFor({ ...plain, offensive: true }) === 28);
check('a full catch halves it',
  damageFor({ ...plain, caught: 1 }) === 10);
check('a half catch takes half of what a full catch would have',
  damageFor({ ...plain, caught: 0.5 }) === 15,
  String(damageFor({ ...plain, caught: 0.5 })));

/*
 * The bonus is inside what the guard halves.
 *
 * The other reading — bonus added after the halving — makes an offensive
 * weapon strictly better than a defensive one in every case, because the one
 * thing a guard is for would no longer touch the advantage it is up against.
 */
check('a catch halves the bonus with it',
  damageFor({ ...plain, offensive: true, caught: 1 }) === 14,
  String(damageFor({ ...plain, offensive: true, caught: 1 })));

check('the final round doubles whatever is left',
  damageFor({ ...plain, offensive: true, caught: 1, multiplier: 2 }) === 28);

// --- the shape of the bargain ----------------------------------------------

/*
 * What each weapon is actually worth, against the same opponent.
 *
 * The win condition is least damage TAKEN, so the offensive bonus does not
 * win a fight directly — it shortens the other one's bar. What decides a
 * round is how much gets through your own guard, and that now depends on both
 * how many sides you cover and how many they strike.
 *
 * Averaged over every combination of sides the two of them might pick, which
 * is the only honest way to compare two blind choices.
 */
const combinations = (count: number): Side[][] => {
  if (count <= 1) return SIDES.map((side) => [side]);
  const out: Side[][] = [];
  for (let i = 0; i < SIDES.length; i++) {
    for (let j = i + 1; j < SIDES.length; j++) out.push([SIDES[i]!, SIDES[j]!]);
  }
  return out;
};

/** Average damage taken per blow, guarding `guards` sides against `strikes`. */
const takenBy = (guards: number, strikes: number, attackerOffensive: boolean) => {
  let total = 0;
  let cases = 0;
  for (const guarded of combinations(guards)) {
    for (const struck of combinations(strikes)) {
      total += damageFor({
        scored: MAX_SCORE / 2,
        offensive: attackerOffensive,
        caught: caughtFraction(move(struck, []), move([], guarded)),
        multiplier: 1,
      });
      cases++;
    }
  }
  return total / cases;
};

// Facing the same thing — an offensive weapon, which strikes two sides.
const takenWithSword = takenBy(guardsFor('offensive'), attacksFor('offensive'), true);
const takenWithShield = takenBy(guardsFor('defensive'), attacksFor('offensive'), true);

check('a defensive weapon still takes less than an offensive one',
  takenWithShield < takenWithSword,
  `sword ${takenWithSword.toFixed(1)}, shield ${takenWithShield.toFixed(1)}`);

const edge = (takenWithSword - takenWithShield)
  / damageFor({ scored: MAX_SCORE / 2, offensive: true, caught: 0, multiplier: 1 });
check('by a margin that makes it a choice rather than an answer',
  edge > 0.05 && edge < 0.35,
  `the shield saves ${(edge * 100).toFixed(0)}% of a blow`);

/*
 * What striking in two places actually buys, which is not what it looks like.
 *
 * Nothing, on average — and that is arithmetic, not an oversight. The catch
 * is proportional, so the expected fraction caught is the same whether a blow
 * lands in one place or two: each struck side has the same chance of being
 * covered, and averaging over two of them changes nothing about the mean.
 *
 * What it buys is consistency. A single strike against a two-side guard is
 * stopped outright half the time; a double strike is stopped outright once in
 * six, and the rest of the time gives up only half. That is the trade an
 * offensive weapon is making, on top of its bonus: fewer disasters, no clean
 * runs. Worth pinning down precisely because it is easy to assume the second
 * strike is a damage increase, build the balance around that, and be wrong.
 */
const dealtWithTwo = takenBy(guardsFor('defensive'), 2, true);
const dealtWithOne = takenBy(guardsFor('defensive'), 1, true);
check('striking two sides is no better on average — the rule is proportional',
  Math.abs(dealtWithTwo - dealtWithOne) < 0.001,
  `two ${dealtWithTwo.toFixed(2)}, one ${dealtWithOne.toFixed(2)}`);

/** How often a blow is stopped outright, over every pairing of choices. */
const shutOutRate = (guards: number, strikes: number) => {
  let stopped = 0;
  let cases = 0;
  for (const guarded of combinations(guards)) {
    for (const struck of combinations(strikes)) {
      if (fullyBlocked(move(struck, []), move([], guarded))) stopped++;
      cases++;
    }
  }
  return stopped / cases;
};

const shutOutStrikingOne = shutOutRate(guardsFor('defensive'), 1);
const shutOutStrikingTwo = shutOutRate(guardsFor('defensive'), 2);
check('but it is stopped outright far less often',
  shutOutStrikingTwo < shutOutStrikingOne / 2,
  `striking one is shut out ${(shutOutStrikingOne * 100).toFixed(0)}% of the time, `
  + `striking two ${(shutOutStrikingTwo * 100).toFixed(0)}%`);

console.log(`\n  shut out completely: striking one ${(shutOutStrikingOne * 100).toFixed(0)}%, `
  + `striking two ${(shutOutStrikingTwo * 100).toFixed(0)}%`);

console.log(`\n  offensive weapon: +${OFFENSIVE_BONUS}, strikes 2, takes ${takenWithSword.toFixed(1)} per blow`);
console.log(`  defensive weapon: no bonus, strikes 1, takes ${takenWithShield.toFixed(1)} per blow`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
