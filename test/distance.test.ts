/**
 * Ranged attacks keep their range.
 *
 * The choreographer is asked not to walk the fighter in before a shot and
 * does it anyway, so the rule is enforced in code. These are the cases that
 * enforcement has to get right — including the ones where an approach is
 * perfectly correct and must survive.
 */
import { aimReactionsAtTheEnemy, closeInForMelee, keepRangedAtRange } from '../server/distance';

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

/*
 * Closing the distance is most of this game, and a first pass at this rule
 * stopped it happening at all: anything that left the body counted as ranged,
 * so a charge into a ground slam lost its charge and the slam landed from
 * across the room.
 */
check('a charge into a slam keeps its charge', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'charge' }, { move: 'slam' }, { move: 'shockwave' }],
}))) === JSON.stringify(['charge', 'slam', 'shockwave']));

check('a shockwave is not a ranged attack', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'move_to' }, { move: 'shockwave' }],
}))) === JSON.stringify(['move_to', 'shockwave']));

check('nor is something dropped out of the sky', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'charge' }, { move: 'summon' }],
}))) === JSON.stringify(['charge', 'summon']));

check('a punch that sends something flying still gets to close the distance',
  JSON.stringify(moves(keepRangedAtRange({
    steps: [{ move: 'dash' }, { move: 'punch' }, { move: 'projectile' }],
  }))) === JSON.stringify(['dash', 'punch', 'projectile']));

check('but a shot that opens the move does not', JSON.stringify(moves(keepRangedAtRange({
  steps: [{ move: 'dash' }, { move: 'projectile' }, { move: 'punch' }],
}))) === JSON.stringify(['projectile', 'punch']));

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

/*
 * Who a reaction happens to.
 *
 * A step with no `on` runs on the attacker, and the model keeps leaving it
 * off — so "poison them" turned the writer's own fighter green while their
 * opponent stood there untouched. Exactly backwards, and the funniest possible
 * way to lose.
 */
const onOf = (value: unknown): (string | undefined)[] =>
  ((value as { steps?: { on?: string }[] }).steps ?? []).map((s) => s.on);

check('poison lands on the enemy by default', JSON.stringify(onOf(aimReactionsAtTheEnemy({
  steps: [{ move: 'swing' }, { move: 'sicken' }],
}))) === JSON.stringify([undefined, 'enemy']));

check('so do dizzy and knockdown', JSON.stringify(onOf(aimReactionsAtTheEnemy({
  steps: [{ move: 'dizzy' }, { move: 'knockdown' }],
}))) === JSON.stringify(['enemy', 'enemy']));

check('an attack is not redirected', JSON.stringify(onOf(aimReactionsAtTheEnemy({
  steps: [{ move: 'punch' }, { move: 'projectile' }],
}))) === JSON.stringify([undefined, undefined]));

// Poisoning yourself for power is a real thing somebody will write.
check('a deliberate self-target is left alone', JSON.stringify(onOf(aimReactionsAtTheEnemy({
  steps: [{ move: 'sicken', on: 'self' }],
}))) === JSON.stringify(['self']));

check('and one already aimed is untouched', JSON.stringify(onOf(aimReactionsAtTheEnemy({
  steps: [{ move: 'sicken', on: 'enemy' }],
}))) === JSON.stringify(['enemy']));

check('nothing malformed throws', aimReactionsAtTheEnemy(null) === null
  && aimReactionsAtTheEnemy('x') === 'x'
  && JSON.stringify(aimReactionsAtTheEnemy({ steps: [1, null] })) === JSON.stringify({ steps: [1, null] }));

/*
 * And the other half: a fighter who needs to be close has to get there.
 *
 * They start a third of the arena apart and a punch lunges twenty-six pixels,
 * so a jab with no approach in front of it was thrown at nothing while the
 * impact appeared over by the opponent.
 */
check('a jab on its own gets walked in', JSON.stringify(moves(closeInForMelee({
  steps: [{ move: 'punch' }, { move: 'recoil' }],
}))) === JSON.stringify(['charge', 'punch', 'recoil']));

check('so does a swing', JSON.stringify(moves(closeInForMelee({
  steps: [{ move: 'swing' }],
}))) === JSON.stringify(['charge', 'swing']));

check('one that already walks in is left alone', JSON.stringify(moves(closeInForMelee({
  steps: [{ move: 'move_to' }, { move: 'punch' }],
}))) === JSON.stringify(['move_to', 'punch']));

check('and a taunt before the walk still counts as before it',
  JSON.stringify(moves(closeInForMelee({
    steps: [{ move: 'taunt' }, { move: 'dash' }, { move: 'kick' }],
  }))) === JSON.stringify(['taunt', 'dash', 'kick']));

// A shot is supposed to be taken from where they stand.
check('a ranged opening is not walked in', JSON.stringify(moves(closeInForMelee({
  steps: [{ move: 'projectile' }, { move: 'recoil' }],
}))) === JSON.stringify(['projectile', 'recoil']));

check('a move with no attack in it is left alone', JSON.stringify(moves(closeInForMelee({
  steps: [{ move: 'taunt' }, { move: 'idle' }],
}))) === JSON.stringify(['taunt', 'idle']));

// The walk goes in front of the punch, not in front of the pose before it.
check('the walk lands just before the blow', JSON.stringify(moves(closeInForMelee({
  steps: [{ move: 'taunt' }, { move: 'punch' }],
}))) === JSON.stringify(['taunt', 'charge', 'punch']));

check('nothing malformed throws here either', closeInForMelee(null) === null
  && closeInForMelee('x') === 'x'
  && JSON.stringify(closeInForMelee({ steps: [1, null] })) === JSON.stringify({ steps: [1, null] }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
