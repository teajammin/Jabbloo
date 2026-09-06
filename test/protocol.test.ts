/**
 * Lobby rule tests.
 *
 * `startBlockedBecause` is the single source of truth for whether a game can
 * begin — the host's Start button and the server's validation both call it — so
 * its edge cases are worth pinning down.
 *
 *   npm test
 */

import { startBlockedBecause, canStart, makeRoomCode, ROOM_CODE_LENGTH } from '../src/shared/protocol';
import type { Player, RoomState } from '../src/shared/protocol';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const player = (name: string, role: Player['role'], isHost = false): Player => ({
  id: name, name, role, connected: true, isHost,
  progress: { drawn: [], named: [], ready: false },
  health: 100,
  fights: 0,
  characterName: name,
  weaponNames: [],
});

const room = (players: Player[]): RoomState => ({
  code: 'ABCD',
  phase: 'lobby',
  capacity: players.filter((p) => !p.isHost).length,
  players,
  teamNames: { teamA: 'A', teamB: 'B' },
  step: -1,
  stepEndsAt: 0,
  votes: {},
  chosen: null,
  turn: null,
});

const host = player('Host', 'unassigned', true);

// Too few players
check('empty room blocked', startBlockedBecause(room([host]))!.includes('Waiting for'));
check('one player blocked', startBlockedBecause(room([host, player('A', 'teamA')]))!.includes('Waiting'));

// Unassigned players
const oneWaiting = room([host, player('Ann', 'teamA'), player('Bo', 'unassigned')]);
check('names the single unassigned player', startBlockedBecause(oneWaiting) === 'Bo still needs a place.',
  String(startBlockedBecause(oneWaiting)));

const twoWaiting = room([
  host, player('Ann', 'unassigned'), player('Bo', 'unassigned'), player('Cy', 'teamA'),
]);
check('counts multiple unassigned', startBlockedBecause(twoWaiting) === '2 players still need a place.',
  String(startBlockedBecause(twoWaiting)));

// Both teams must be populated
const lopsided = room([host, player('Ann', 'teamA'), player('Bo', 'teamA')]);
check('one-sided teams blocked',
  startBlockedBecause(lopsided) === 'Both teams need at least one fighter.',
  String(startBlockedBecause(lopsided)));

const allJudges = room([host, player('Ann', 'judge'), player('Bo', 'judge')]);
check('all judges blocked', startBlockedBecause(allJudges) !== null);

// Valid arrangements
check('1v1 can start', canStart(room([host, player('Ann', 'teamA'), player('Bo', 'teamB')])));

check('3 players with a judge can start', canStart(room([
  host, player('Ann', 'teamA'), player('Bo', 'teamB'), player('Cy', 'judge'),
])));

check('2v2 tag team can start', canStart(room([
  host, player('Ann', 'teamA'), player('Az', 'teamA'),
  player('Bo', 'teamB'), player('Bz', 'teamB'),
])));

// A disconnected player still holds their seat, so they must not block start.
const withOffline = room([
  host, player('Ann', 'teamA'), { ...player('Bo', 'teamB'), connected: false },
]);
check('offline player does not block start', canStart(withOffline));

// Room codes
const code = makeRoomCode();
check('code is the right length', code.length === ROOM_CODE_LENGTH, code);
check('code has no vowels', !/[AEIOU]/.test(code), code);
check('code is uppercase letters', /^[A-Z]+$/.test(code), code);

// --- the battleground draw -------------------------------------------------
// Every vote is a ticket, so a ground with more votes is likelier but never
// certain. These pin down that behaviour, including the empty-room case.

import { drawBattleground } from '../src/shared/protocol';

const GROUNDS = ['meadow', 'sky', 'blossom', 'butter'];

check('draws the only voted ground',
  drawBattleground({ a: 'sky', b: 'sky' }, GROUNDS) === 'sky');

check('with no votes it still draws something',
  GROUNDS.includes(drawBattleground({}, GROUNDS)));

check('ignores votes for grounds that do not exist',
  drawBattleground({ a: 'lava', b: 'meadow' }, GROUNDS) === 'meadow');

// A tie must be able to go either way — never fixed to the first entry.
const seen = new Set<string>();
for (let i = 0; i < 200; i++) {
  seen.add(drawBattleground({ a: 'sky', b: 'butter' }, GROUNDS));
}
check('a tie can go either way', seen.size === 2, [...seen].join());

// More votes should win more often, without being guaranteed.
let skyWins = 0;
for (let i = 0; i < 2000; i++) {
  if (drawBattleground({ a: 'sky', b: 'sky', c: 'sky', d: 'butter' }, GROUNDS) === 'sky') skyWins++;
}
check('more votes means likelier, near 75%', skyWins > 1350 && skyWins < 1650, String(skyWins));

// --- written moves ---------------------------------------------------------

import { trimPrompt, wordCount, MAX_PROMPT_WORDS } from '../src/shared/protocol';

check('counts words, not characters', wordCount('spin the sword overhead') === 4);
check('ignores extra spacing', wordCount('  spin   the   sword  ') === 3);
check('an empty prompt is zero', wordCount('   ') === 0);

const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
check(`trims to ${MAX_PROMPT_WORDS} words`, wordCount(trimPrompt(long)) === MAX_PROMPT_WORDS);
check('keeps the opening words', trimPrompt(long).startsWith('w0 w1 w2'));
check('a short prompt is untouched', trimPrompt('bonk them') === 'bonk them');
check('collapses whitespace', trimPrompt(' bonk\n  them ') === 'bonk them');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
