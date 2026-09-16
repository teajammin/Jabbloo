/**
 * What the commentator says.
 *
 * The lines land on the movements they describe, so there has to be one per
 * step and it has to be short enough to finish inside it. Silence is a valid
 * line: a voice that narrates the recoil and the settle as well as the blow is
 * a voice nobody wants at a party.
 */
import { describeSteps, describeBeats } from '../src/ui/commentary';
import { LINES } from '../src/shared/lines';

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

/*
 * The recordings, which are what actually gets heard.
 *
 * Every beat that asks for a line has to ask for one that exists: the audio is
 * rendered ahead of time from the same list, so a typo here is a beat that
 * plays in silence on every machine in the world at once.
 */
const beats = (steps: unknown[]) =>
  describeBeats({ steps } as never, 'Bonk', 'Squish', 'Butter Sword');

const known = new Set(LINES.map((l) => l.id));

const everyMove = [
  { move: 'charge' }, { move: 'swing' }, { move: 'slam' }, { move: 'spin_weapon' },
  { move: 'throw' }, { move: 'punch' }, { move: 'punch', params: { style: 'uppercut' } },
  { move: 'kick' }, { move: 'headbutt' }, { move: 'bite' }, { move: 'grab' },
  { move: 'stomp' }, { move: 'beam' }, { move: 'summon' }, { move: 'teleport' },
  { move: 'taunt' }, { move: 'inhale' }, { move: 'grow' }, { move: 'shrink' },
  { move: 'flip' }, { move: 'handspring' },
  { move: 'knockdown', on: 'enemy' }, { move: 'dizzy', on: 'enemy' },
  ...['bullet', 'arrow', 'fire', 'ice', 'sun', 'rock', 'banana']
    .map((kind) => ({ move: 'projectile', params: { kind } })),
  ...['stink', 'water', 'sound']
    .map((kind) => ({ move: 'shockwave', params: { kind } })),
  ...['poison', 'burn', 'curse', 'love', 'hypnotised', 'frozen', 'shocked',
    'stink', 'confused', 'drunk']
    .map((kind) => ({ move: 'sicken', on: 'enemy', params: { kind } })),
];

const asked = beats(everyMove).map((b) => b.line).filter(Boolean);
check('every move asks for a line', asked.length > 30, String(asked.length));
check('and every line it asks for was recorded',
  asked.every((id) => known.has(id)),
  JSON.stringify([...new Set(asked.filter((id) => !known.has(id)))]));

// The moments that are not steps.
check('the stingers were recorded too',
  ['fight', 'final', 'ready'].every((id) => known.has(id)));

check('a quiet beat asks for nothing',
  beats([{ move: 'shake_screen' }])[0]?.line === '');
check('an unknown move asks for nothing',
  beats([{ move: 'interpretive_dance' }])[0]?.line === '');
check('rubbish asks for nothing', beats([null])[0]?.line === '');

// The caption still carries the names the recordings cannot.
const named = beats([{ move: 'sicken', on: 'enemy', params: { kind: 'love' } }])[0];
check('the caption names who it happened to',
  named?.caption.includes('Squish') === true, named?.caption);
check('while the recording stays name-free', named?.line === 'love');

/*
 * And the files exist.
 *
 * The recordings are generated by a script and committed, so a line added to
 * the list without re-running it is a beat that is silent everywhere. Checking
 * the directory is the only way to know.
 */
const { existsSync } = await import('node:fs');
const missing = LINES.filter((line) => !existsSync(`${process.cwd()}/public/vo/${line.id}.mp3`));
check('every line has a recording on disk',
  missing.length === 0,
  `missing: ${missing.map((l) => l.id).join(', ')} — run npm run gen:voice`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
