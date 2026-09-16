/**
 * What the commentator says.
 *
 * The lines land on the movements they describe, so there has to be one per
 * step and it has to be short enough to finish inside it. Silence is a valid
 * line: a voice that narrates the recoil and the settle as well as the blow is
 * a voice nobody wants at a party.
 */
import { describeSteps } from '../src/ui/commentary';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const lines = (steps: unknown[]) =>
  describeSteps({ steps } as never, 'Bonk', 'Squish', 'Butter Sword');

check('one line per step, always',
  lines([{ move: 'charge' }, { move: 'swing' }, { move: 'recoil' }]).length === 3);

const shot = lines([{ move: 'projectile', params: { kind: 'bullet' } }]);
check('a bullet is called', /shots fired/i.test(shot[0] ?? ''), shot[0]);

const swing = lines([{ move: 'swing' }]);
check('a swing names the weapon', swing[0]?.includes('Butter Sword') === true, swing[0]);

const poison = lines([{ move: 'sicken', params: { kind: 'poison' }, on: 'enemy' }]);
check('poison is called on the one who got it',
  poison[0]?.includes('Squish') === true && /poisoned/i.test(poison[0] ?? ''), poison[0]);

const love = lines([{ move: 'sicken', params: { kind: 'love' }, on: 'enemy' }]);
check('and so is love', /head over heels/i.test(love[0] ?? ''), love[0]);

const hypno = lines([{ move: 'sicken', params: { kind: 'hypnotised' }, on: 'enemy' }]);
check('and hypnotism', /hypnotised/i.test(hypno[0] ?? ''), hypno[0]);

// The quiet beats.
check('a screen shake says nothing', lines([{ move: 'shake_screen' }])[0] === '');
check('nor does a recoil', lines([{ move: 'recoil' }])[0] === '');
check('nor an idle', lines([{ move: 'idle' }])[0] === '');

// Walking in is worth saying once, at the top, and never again.
const twoWalks = lines([{ move: 'charge' }, { move: 'punch' }, { move: 'dash' }]);
check('the approach is called once', twoWalks[0] !== '' && twoWalks[2] === '',
  JSON.stringify(twoWalks));

// Short enough to finish inside the beat it belongs to.
const every = lines([
  { move: 'charge' }, { move: 'swing' }, { move: 'slam' }, { move: 'throw' },
  { move: 'punch' }, { move: 'kick' }, { move: 'bite' }, { move: 'beam' },
  { move: 'summon' }, { move: 'knockdown', on: 'enemy' }, { move: 'teleport' },
]);
check('every line is short enough to say quickly',
  every.every((line) => line.length <= 46),
  JSON.stringify(every.filter((l) => l.length > 46)));

// Nothing malformed may throw: these come from a model.
check('an unknown move is silent rather than wrong',
  lines([{ move: 'interpretive_dance' }])[0] === '');
check('a step with no move at all is handled', lines([{}])[0] === '');
check('no steps at all is handled', lines([]).length === 0);
check('rubbish in the list is handled', lines([null, 'nonsense', 7]).length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
