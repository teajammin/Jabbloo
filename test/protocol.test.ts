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
});

const room = (players: Player[]): RoomState => ({
  code: 'ABCD',
  phase: 'lobby',
  capacity: players.filter((p) => !p.isHost).length,
  players,
  teamNames: { teamA: 'A', teamB: 'B' },
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
