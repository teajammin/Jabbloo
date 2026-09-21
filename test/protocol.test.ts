/**
 * Lobby rule tests.
 *
 * `startBlockedBecause` is the single source of truth for whether a game can
 * begin — the host's Start button and the server's validation both call it — so
 * its edge cases are worth pinning down.
 *
 *   npm test
 */

import { isDuel, startBlockedBecause, canStart, makeRoomCode, ROOM_CODE_LENGTH } from '../src/shared/protocol';
import type { Player, RoomState } from '../src/shared/protocol';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const player = (name: string, role: Player['role'], isHost = false): Player => ({
  id: name, name, role, connected: true, isHost, leftAt: 0,
  progress: { drawn: [], named: [], step: 0, endsAt: 0, done: false },
  health: 100,
  fights: 0,
  characterName: name,
  weaponNames: [],
  weaponKinds: [],
  damageDealt: 0,
  damageTaken: 0,
  best: null,
});

const room = (players: Player[]): RoomState => ({
  code: 'ABCD',
  phase: 'lobby',
  capacity: players.filter((p) => !p.isHost).length,
  players,
  teamNames: { teamA: 'A', teamB: 'B' },
  step: -1,
  ultRound: 0,
  stepEndsAt: 0,
  votes: {},
  chosen: null,
  rematchReady: null,
  turn: null,
});

const host = player('Host', 'unassigned', true);

// Too few players
check('empty room blocked', startBlockedBecause(room([host]))!.includes('Waiting for'));
check('one player blocked', startBlockedBecause(room([host, player('A', 'teamA')]))!.includes('Waiting'));

/*
 * Two players are a duel and arrange themselves, so none of the rules about
 * places and sides apply until there are three. Each case below is therefore
 * written with three or more.
 */
const duel = room([host, player('Ann', 'unassigned'), player('Bo', 'unassigned')]);
check('two players need no arranging at all', startBlockedBecause(duel) === null,
  String(startBlockedBecause(duel)));

const duelSameSide = room([host, player('Ann', 'teamA'), player('Bo', 'teamA')]);
check('and are not blocked for being on one side',
  startBlockedBecause(duelSameSide) === null, String(startBlockedBecause(duelSameSide)));

// Unassigned players
const oneWaiting = room([
  host, player('Ann', 'teamA'), player('Cy', 'teamB'), player('Bo', 'unassigned'),
]);
check('names the single unassigned player', startBlockedBecause(oneWaiting) === 'Bo still needs a place.',
  String(startBlockedBecause(oneWaiting)));

const twoWaiting = room([
  host, player('Ann', 'unassigned'), player('Bo', 'unassigned'), player('Cy', 'teamA'),
]);
check('counts multiple unassigned', startBlockedBecause(twoWaiting) === '2 players still need a place.',
  String(startBlockedBecause(twoWaiting)));

// Both teams must be populated, once there are enough players to have teams.
const lopsided = room([
  host, player('Ann', 'teamA'), player('Bo', 'teamA'), player('Cy', 'judge'),
]);
check('one-sided teams blocked',
  startBlockedBecause(lopsided) === 'Both teams need at least one fighter.',
  String(startBlockedBecause(lopsided)));

const allJudges = room([
  host, player('Ann', 'judge'), player('Bo', 'judge'), player('Cy', 'judge'),
]);
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

// --- judging ---------------------------------------------------------------

import { averageScore, type Turn } from '../src/shared/protocol';

const turnWith = (judged: Record<string, Record<string, number>>): Turn => ({
  index: 1, fighters: ['ann', 'bo'], moves: {}, judged, damage: {},
  guarded: {}, notes: {},
  first: null, phase: 'judging',
});

check('one judge stands alone',
  averageScore(turnWith({ j1: { ann: 20 } }), 'ann') === 20);
check('two judges average',
  averageScore(turnWith({ j1: { ann: 20 }, j2: { ann: 10 } }), 'ann') === 15);
check('averages round to a whole number',
  averageScore(turnWith({ j1: { ann: 20 }, j2: { ann: 11 } }), 'ann') === 16);
check('a judge who skipped one fighter is ignored for them',
  averageScore(turnWith({ j1: { ann: 20 }, j2: { bo: 10 } }), 'ann') === 20);
check('nobody scored means no damage',
  averageScore(turnWith({}), 'ann') === 0);

// --- who wins --------------------------------------------------------------

import { teamDamage, winningTeam } from '../src/shared/protocol';
import {
  MAX_MESSAGE_BYTES, MAX_PHOTO_BYTES, MAX_ARTWORK_BYTES, byteLength,
} from '../src/shared/protocol';

const hurt = (p: Player, taken: number): Player => ({ ...p, damageTaken: taken });

const fight = (aTaken: number, bTaken: number) => room([
  host,
  hurt(player('Ann', 'teamA'), aTaken),
  hurt(player('Bo', 'teamB'), bTaken),
]);

check('team damage sums its players',
  teamDamage(room([host, hurt(player('Ann', 'teamA'), 20), hurt(player('Az', 'teamA'), 15)]), 'teamA') === 35);
check('least damage taken wins', winningTeam(fight(30, 60)) === 'teamA');
check('and the other way round', winningTeam(fight(60, 30)) === 'teamB');
check('level means no winner yet', winningTeam(fight(40, 40)) === null);
check('nobody hurt is still level', winningTeam(fight(0, 0)) === null);

// The wire limits. test/limits.test.mjs proves the first of these against a
// running server with the same number written out, so a change here without a
// change there would be caught rather than silently untested.
check('the platform limit is one mebibyte', MAX_MESSAGE_BYTES === 1_048_576);
check('a photo budget well inside it', MAX_PHOTO_BYTES === 120_000);
check('and artwork under three quarters of it',
  MAX_ARTWORK_BYTES < MAX_MESSAGE_BYTES * 0.75);
check('byte length counts bytes, not characters', byteLength('a\u00e9\u20ac') === 6,
  String(byteLength('a\u00e9\u20ac')));

// Which rooms are duels.
check('two players are a duel',
  isDuel(room([host, player('Ann', 'teamA'), player('Bo', 'teamB')])));
check('three are not',
  !isDuel(room([host, player('Ann', 'teamA'), player('Bo', 'teamB'), player('Cy', 'judge')])));
check('and one is not either', !isDuel(room([host, player('Ann', 'teamA')])));
check('the host does not count toward it',
  isDuel(room([host, player('Ann', 'teamA'), player('Bo', 'teamB')])));

import { GRACE_SECONDS, graceExpired, graceRemaining } from '../src/shared/protocol';

// The grace period: how long a phone may be asleep before the game gives up
// on it. The boundary is the whole point — one second either side of it is the
// difference between a locked screen and a forfeit.
const away = (secondsAgo: number): Player => ({
  ...player('Gone', 'teamA'),
  connected: false,
  leftAt: Date.now() - secondsAgo * 1000,
});

check('a connected player is never written off',
  !graceExpired(player('Ann', 'teamA')));
check('nor is one who just dropped', !graceExpired(away(1)));
check('nor one a second short of the grace', !graceExpired(away(GRACE_SECONDS - 1)));
check('but one past it is', graceExpired(away(GRACE_SECONDS + 1)));
check('and exactly on it counts as past', graceExpired(away(GRACE_SECONDS)));
check('a seat nobody has left is not counting down',
  !graceExpired({ ...player('Ann', 'teamA'), connected: false, leftAt: 0 }));

check('the countdown reads the seconds left',
  graceRemaining(away(5)) === GRACE_SECONDS - 5, String(graceRemaining(away(5))));
check('and stops at zero rather than going negative',
  graceRemaining(away(GRACE_SECONDS + 10)) === 0);
check('a connected player has no countdown', graceRemaining(player('Ann', 'teamA')) === 0);

/*
 * Artwork arriving in pieces.
 *
 * A player who imported photographs has more than a megabyte of PNG between
 * their character and their weapons, and the platform closes a socket that
 * carries a message that size rather than rejecting it — so the whole lot in
 * one message took the host's screen down as the battle opened and everyone
 * whose art had not arrived fought as a stand-in.
 */
import { mergeArt, type PlayerArt } from '../src/shared/protocol';

const piece = (over: Partial<PlayerArt>): PlayerArt => ({
  playerId: 'ann', character: null, weapons: [], ...over,
});

const face = { png: 'face.png', name: 'Ann' };
const sword = { png: 'sword.png', name: 'Sword', index: 0 };
const axe = { png: 'axe.png', name: 'Axe', index: 1 };

check('the first piece stands on its own',
  mergeArt(undefined, piece({ character: face })).character?.png === 'face.png');

let built = mergeArt(undefined, piece({ character: face }));
built = mergeArt(built, piece({ weapons: [sword] }));
built = mergeArt(built, piece({ weapons: [axe] }));
check('a character and two weapons come back whole',
  built.character?.png === 'face.png' && built.weapons.length === 2,
  JSON.stringify(built.weapons.length));
check('and in the order they were drawn',
  built.weapons[0]?.name === 'Sword' && built.weapons[1]?.name === 'Axe',
  JSON.stringify(built.weapons.map((w) => w.name)));

// Messages are not promised in order, and a weapon knows its own slot.
let reversed = mergeArt(undefined, piece({ weapons: [axe] }));
reversed = mergeArt(reversed, piece({ weapons: [sword] }));
reversed = mergeArt(reversed, piece({ character: face }));
check('arriving out of order does not scramble them',
  reversed.weapons[0]?.name === 'Sword' && reversed.weapons[1]?.name === 'Axe',
  JSON.stringify(reversed.weapons.map((w) => w.name)));
check('and the character still lands', reversed.character?.png === 'face.png');

// A redraw replaces what it replaces.
const redrawn = mergeArt(built, piece({ weapons: [{ png: 'new.png', name: 'Better', index: 0 }] }));
check('a later piece wins', redrawn.weapons[0]?.name === 'Better',
  JSON.stringify(redrawn.weapons.map((w) => w.name)));
check('without disturbing the others', redrawn.weapons[1]?.name === 'Axe');

// A weapon knows its own slot, and keeps it even when it is the only thing
// that has turned up: the fight asks for a weapon by the slot it was drawn
// in, so slot one must not answer to slot zero just because it arrived first.
const gappy = mergeArt(undefined, piece({ weapons: [axe] }));
check('a lone second weapon stays in its own slot',
  gappy.weapons[1]?.name === 'Axe' && gappy.weapons[0] === undefined,
  JSON.stringify(gappy.weapons));

/*
 * How long the room is actually waiting.
 *
 * A player's own deadline covers the step they are on and nothing else, so the
 * furthest-away deadline in the room was not the answer to "how long until
 * everyone is finished" — somebody on the first of six steps has a deadline
 * seconds away and almost all of creation still in front of them.
 */
import { longestRemaining, remainingFor, stepsFor } from '../src/shared/protocol';

const NOW = 1_000_000;
// The fixture builds a lobby; creation is the phase that has steps in it.
const creating = (players: Player[]): RoomState => ({ ...room(players), phase: 'creating' });

const working = (name: string, step: number, endsIn: number): Player => ({
  ...player(name, 'teamA'),
  progress: { drawn: [], named: [], step, endsAt: NOW + endsIn, done: false },
});

const steps = stepsFor(creating([]));
const secondsAfter = (step: number) =>
  steps.slice(step + 1).reduce((total, s) => total + s.seconds * 1000, 0);

check('somebody mid-step is owed the rest of that step',
  remainingFor(working('Ann', steps.length - 1, 9000), creating([]), NOW) === 9000,
  String(remainingFor(working('Ann', steps.length - 1, 9000), creating([]), NOW)));

check('and every step they have not reached',
  remainingFor(working('Ann', 0, 9000), creating([]), NOW) === 9000 + secondsAfter(0),
  String(remainingFor(working('Ann', 0, 9000), creating([]), NOW)));

const finished = (name: string): Player => ({
  ...player(name, 'teamA'),
  progress: { drawn: [], named: [], step: steps.length, endsAt: 0, done: true },
});

check('somebody finished is owed nothing',
  remainingFor(finished('Ann'), creating([]), NOW) === 0);

/*
 * The case that was wrong: the person on the later step has the later
 * deadline, and is the one who will finish first.
 */
const early = working('Early', 0, 10_000);
const late = working('Late', steps.length - 1, 30_000);
const both = creating([host, early, late]);

check('the slowest is the one with the most left, not the latest deadline',
  longestRemaining(both, NOW) === remainingFor(early, both, NOW),
  `${longestRemaining(both, NOW)} vs early ${remainingFor(early, both, NOW)}`);
check('which is longer than the later deadline on its own',
  longestRemaining(both, NOW) > 30_000, String(longestRemaining(both, NOW)));

check('a room where everyone has finished waits for nothing',
  longestRemaining(creating([host, finished('Ann')]), NOW) === 0,
  String(longestRemaining(creating([host, finished('Ann')]), NOW)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
