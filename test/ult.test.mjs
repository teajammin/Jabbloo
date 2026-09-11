/**
 * Ultimate tiebreaker tests.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * The brief's rule: a level score does not end the game — both sides draw one
 * more weapon and fight again with it. What is checked here is that a tie
 * routes into an Ultimate, that the extra weapon lands in the right slot, that the
 * ULT leads straight back into a fight, and that the loop is capped so a
 * perfectly even pair of teams eventually gets an answer.
 */
import { GROUND_IDS } from './grounds.mjs';
let room = '';
const freshRoom = () => { room = 'ULT' + Math.floor(Math.random() * 900000 + 100000); };
const url = () => `ws://127.0.0.1:1999/parties/main/${room}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(url());
  ws.inbox = [];
  ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
  ws.addEventListener('open', () => resolve(ws));
  ws.addEventListener('error', reject);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.type === t);
const state = (ws) => last(ws, 'state')?.state ?? last(ws, 'welcome')?.state;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

async function setup() {
  freshRoom();
  const host = await open();
  host.send(JSON.stringify({ type: 'host', capacity: 2 }));
  await wait(200);
  const a = await open(); a.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  const b = await open(); b.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  await wait(350);

  const ids = state(host).players.filter((p) => !p.isHost).map((p) => p.id);
  host.send(JSON.stringify({ type: 'setRole', playerId: ids[0], role: 'teamA' }));
  host.send(JSON.stringify({ type: 'setRole', playerId: ids[1], role: 'teamB' }));
  await wait(200);
  host.send(JSON.stringify({ type: 'start' }));
  await wait(200);

  for (let i = 0; i < 16; i++) {
    a.send(JSON.stringify({ type: 'ready' }));
    b.send(JSON.stringify({ type: 'ready' }));
    await wait(80);
    if (state(host).phase !== 'creating') break;
  }
  await wait(200);
  a.send(JSON.stringify({ type: 'voteBattleground', id: GROUND_IDS[0] }));
  b.send(JSON.stringify({ type: 'voteBattleground', id: GROUND_IDS[0] }));
  await wait(4600);
  return { host, a, b, ids };
}

/** One exchange where both fighters score the same, so the tie holds. */
async function evenRound(host, a, b, ids, score = 8) {
  a.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'an even swing' }));
  b.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'an even swing' }));
  await wait(200);
  host.send(JSON.stringify({ type: 'turnPlayed' }));
  await wait(180);
  host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score }));
  host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[1], score }));
  await wait(220);
  host.send(JSON.stringify({ type: 'turnDone' }));
  await wait(220);
}

const { host, a, b, ids } = await setup();
check('battle reached', state(host).phase === 'battle', state(host).phase);

for (let round = 0; round < 3; round++) await evenRound(host, a, b, ids);

const tied = state(host);
check('a level score does not end the game', tied.phase === 'ult', tied.phase);
check('the Ultimate is counted', tied.ultRound === 1, String(tied.ultRound));
check('it starts at the first step', tied.step === 0, String(tied.step));
check('the Ultimate has its own deadline', tied.stepEndsAt > Date.now(), String(tied.stepEndsAt));
check('nobody carries a stale ready flag',
  tied.players.every((p) => !p.progress.ready));

// The extra weapon continues the numbering rather than replacing one.
a.send(JSON.stringify({ type: 'submitDrawing', slot: 'weapon3', png: PNG, done: true }));
b.send(JSON.stringify({ type: 'submitDrawing', slot: 'weapon3', png: PNG, done: true }));
await wait(250);
check('the Ultimate drawing lands in a fourth slot',
  state(host).players.find((p) => p.id === ids[0])?.progress.drawn.includes('weapon3'));
check('the naming step follows', state(host).step === 1, String(state(host).step));

a.send(JSON.stringify({ type: 'submitName', slot: 'weapon3', name: 'Sun Thrower' }));
b.send(JSON.stringify({ type: 'submitName', slot: 'weapon3', name: '' }));
await wait(300);

const fighting = state(host);
check('the Ultimate leads straight back into a fight', fighting.phase === 'battle', fighting.phase);
check('the Ultimate is theirs to swing',
  fighting.players.find((p) => p.id === ids[0])?.weaponNames[3] === 'Sun Thrower');
check('an unnamed Ultimate still gets a name',
  fighting.players.find((p) => p.id === ids[1])?.weaponNames[3] === 'Ultimate',
  fighting.players.find((p) => p.id === ids[1])?.weaponNames[3]);
check('the sudden-death round is one fight each',
  fighting.players.filter((p) => !p.isHost).every((p) => p.fights === 2),
  JSON.stringify(fighting.players.filter((p) => !p.isHost).map((p) => p.fights)));
check('a knocked-out fighter is back on their feet',
  fighting.players.filter((p) => !p.isHost).every((p) => p.health > 0));

// The Ultimate is a fourth weapon, and picking it must actually swing it. A
// ceiling of three silently turned every Ultimate into the third weapon.
{
  a.send(JSON.stringify({ type: 'submitMove', weapon: 3, prompt: 'the ultimate' }));
  b.send(JSON.stringify({ type: 'submitMove', weapon: 3, prompt: 'theirs too' }));
  await wait(300);
  const chosen = state(host).turn?.moves[ids[0]]?.weapon;
  check('choosing the Ultimate keeps the Ultimate', chosen === 3, String(chosen));

  host.send(JSON.stringify({ type: 'turnPlayed' }));
  await wait(200);
  host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score: 8 }));
  host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[1], score: 8 }));
  await wait(260);
  host.send(JSON.stringify({ type: 'turnDone' }));
  await wait(260);
}

// Still level after the ULT: one more is allowed, then the game accepts a tie.
await evenRound(host, a, b, ids);
check('a second tie forces a second Ultimate', state(host).phase === 'ult', state(host).phase);
check('the second Ultimate takes the next slot up',
  state(host).ultRound === 2, String(state(host).ultRound));

a.send(JSON.stringify({ type: 'submitDrawing', slot: 'weapon4', png: PNG, done: true }));
b.send(JSON.stringify({ type: 'submitDrawing', slot: 'weapon4', png: PNG, done: true }));
await wait(250);
a.send(JSON.stringify({ type: 'submitName', slot: 'weapon4', name: 'Last Word' }));
b.send(JSON.stringify({ type: 'submitName', slot: 'weapon4', name: 'Final Say' }));
await wait(300);
check('the second Ultimate fights too', state(host).phase === 'battle', state(host).phase);

await evenRound(host, a, b, ids);
const done = state(host);
check('the cap stops the loop', done.phase === 'results', done.phase);
check('and the game is declared a tie',
  done.players.find((p) => p.id === ids[0])?.damageTaken ===
  done.players.find((p) => p.id === ids[1])?.damageTaken);

for (const ws of [host, a, b]) ws.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
