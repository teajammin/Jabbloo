/**
 * Ranged attacks keep their range.
 *
 * The choreographer is asked not to walk the fighter in before a shot and
 * does it anyway, so the rule is enforced in code. These are the cases that
 * enforcement has to get right — including the ones where an approach is
 * perfectly correct and must survive.
 */
import { keepRangedAtRange } from '../server/distance';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const moves = (value: unknown): string[] =>
  ((value as { steps?: { move?: string }[] }).steps ?? []).map((s) => s.move ?? '?');

// What the model actually returns for "shoot the other player".
check('the walk before a shot goes', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'move_to' }, { move: 'projectile' }, { move: 'recoil' }],
}))) === JSON.stringify(['projectile', 'recoil']));

check('and the charge before a throw', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'charge' }, { move: 'throw' }, { move: 'shake_screen' }],
}))) === JSON.stringify(['throw', 'shake_screen']));

check('every approach before it, not just the last', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'move_to' }, { move: 'dash' }, { move: 'beam' }],
}))) === JSON.stringify(['beam']));

// Rushing in after the shot is a fair follow-up and must survive.
check('closing in afterwards is left alone', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'projectile' }, { move: 'dash' }, { move: 'punch' }],
}))) === JSON.stringify(['projectile', 'dash', 'punch']));

// A melee move is supposed to close the distance.
check('a melee approach is left alone', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'move_to' }, { move: 'swing' }, { move: 'recoil' }],
}))) === JSON.stringify(['move_to', 'swing', 'recoil']));

// Something happening TO the enemy is not the attacker walking anywhere.
check('the enemy being moved is not an approach', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'move_to', on: 'enemy' }, { move: 'projectile' }],
}))) === JSON.stringify(['move_to', 'projectile']));

check('a ranged move already first is untouched', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'projectile' }, { move: 'recoil' }],
}))) === JSON.stringify(['projectile', 'recoil']));

// Nothing malformed may throw: this runs on every choreography the model
// returns, including the bad ones, and validation proper happens downstream.
check('no steps at all', keepRangedAtRange({}) !== undefined);
check('null', keepRangedAtRange(null) === null);
check('a string', keepRangedAtRange('nonsense') === 'nonsense');
check('steps that are not objects', JSON.stringify(keepRangedAtRange({ steps: [1, 'two', null] }))
  === JSON.stringify({ steps: [1, 'two', null] }));
check('steps with no move', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ params: {} }, { move: 'projectile' }],
}))) === JSON.stringify(['?', 'projectile']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
