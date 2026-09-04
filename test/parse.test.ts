/**
 * Choreography parser tests.
 *
 * The parser's whole job is surviving whatever a language model returns, so
 * these cases are the observed failure modes rather than happy paths: prose
 * around the JSON, invented move names, missing params, and `on: "enemy"` on
 * an attack (which inverts who performs it).
 *
 *   npm test
 */

import { parseChoreography, DEFAULT_CHOREOGRAPHY, MAX_STEPS } from '../src/engine/player';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const isDefault = (c: unknown) => c === DEFAULT_CHOREOGRAPHY;

// valid shapes
const a = parseChoreography({ steps: [{ move: 'swing', params: { arc: 90 } }] });
check('object with steps', a.steps.length === 1 && a.steps[0]!.move === 'swing');

const b = parseChoreography([{ move: 'jump' }, { move: 'idle' }]);
check('bare array', b.steps.length === 2);

// AI failure modes
check('null', isDefault(parseChoreography(null)));
check('string', isDefault(parseChoreography('charge at them!')));
check('empty array', isDefault(parseChoreography([])));
check('prose-wrapped object', isDefault(parseChoreography({ text: 'here you go' })));
check('all unknown moves', isDefault(parseChoreography([{ move: 'moonwalk' }, { move: 'summon_dragon' }])));

const mixed = parseChoreography([
  { move: 'reverse_time' },
  { move: 'swing', params: { arc: 120 } },
  'not an object',
  null,
  { move: 'slam' },
]);
check('mixed valid/invalid keeps only valid', mixed.steps.length === 2,
  `got ${JSON.stringify(mixed.steps.map(s => s.move))}`);

// step cap
const many = parseChoreography(Array.from({ length: 40 }, () => ({ move: 'idle' })));
check(`caps at ${MAX_STEPS} steps`, many.steps.length === MAX_STEPS, `got ${many.steps.length}`);

// params coercion
const p = parseChoreography([{ move: 'swing', params: 'fast' }]);
check('non-object params becomes {}', JSON.stringify(p.steps[0]!.params) === '{}');

const q = parseChoreography([{ move: 'swing' }]);
check('missing params becomes {}', JSON.stringify(q.steps[0]!.params) === '{}');

// on: "enemy" is honoured only for reaction moves — models mark attacks that
// way, which inverts who is doing what.
const react = parseChoreography([{ move: 'knockdown', on: 'enemy' }]);
check('on:enemy kept for reactions', react.steps[0]!.on === 'enemy');

const attack = parseChoreography([{ move: 'inhale', on: 'enemy' }]);
check('on:enemy stripped from attacks', attack.steps[0]!.on === undefined,
  `got ${JSON.stringify(attack.steps[0])}`);

const kick = parseChoreography([{ move: 'kick', on: 'enemy', params: { style: 'sweep' } }]);
check('on:enemy stripped from kick', kick.steps[0]!.on === undefined);

const dizzySelf = parseChoreography([{ move: 'dizzy' }]);
check('no on field stays self', dizzySelf.steps[0]!.on === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
