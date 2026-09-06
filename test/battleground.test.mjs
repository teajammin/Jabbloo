/**
 * Battleground vote integration tests.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * The rules worth pinning down are the ones a player would notice: judges get
 * a vote, the draw only ever lands on something someone picked, voting twice
 * replaces rather than stacks, and the result is held on screen before the
 * battle rather than snapping straight past it.
 */
const ROOM = 'BGX' + Math.floor(Math.random() * 9000 + 1000);
const URL_ = `ws://127.0.0.1:1999/parties/main/${ROOM}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(URL_);
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

const host = await open();
host.send(JSON.stringify({ type: 'host', capacity: 3 }));
await wait(200);
const a = await open(); a.send(JSON.stringify({ type: 'join', name: 'Ann' }));
const b = await open(); b.send(JSON.stringify({ type: 'join', name: 'Bo' }));
const j = await open(); j.send(JSON.stringify({ type: 'join', name: 'Jud' }));
await wait(350);

const ids = state(host).players.filter((p) => !p.isHost).map((p) => p.id);
host.send(JSON.stringify({ type: 'setRole', playerId: ids[0], role: 'teamA' }));
host.send(JSON.stringify({ type: 'setRole', playerId: ids[1], role: 'teamB' }));
host.send(JSON.stringify({ type: 'setRole', playerId: ids[2], role: 'judge' }));
await wait(250);
host.send(JSON.stringify({ type: 'start' }));
await wait(250);

// Race through all sixteen creation steps by having both fighters finish each.
for (let i = 0; i < 16; i++) {
  a.send(JSON.stringify({ type: 'ready' }));
  b.send(JSON.stringify({ type: 'ready' }));
  await wait(90);
  if (state(host).phase !== 'creating') break;
}
await wait(300);

let s = state(host);
check('creation leads to the vote', s.phase === 'battleground', s.phase);
check('the vote has a deadline', s.stepEndsAt > Date.now());
check('nothing is drawn yet', s.chosen === null, String(s.chosen));

a.send(JSON.stringify({ type: 'voteBattleground', id: 'sky' }));
await wait(150);
check('a vote is recorded', state(host).votes[ids[0]] === 'sky');
check('one vote does not close it', state(host).chosen === null);

// Voting again should move the ticket, not add a second one.
a.send(JSON.stringify({ type: 'voteBattleground', id: 'meadow' }));
await wait(150);
check('voting again replaces', state(host).votes[ids[0]] === 'meadow');

// A ground that does not exist must be refused outright.
b.send(JSON.stringify({ type: 'voteBattleground', id: 'lava' }));
await wait(150);
check('an unknown ground is refused', state(host).votes[ids[1]] === undefined);

b.send(JSON.stringify({ type: 'voteBattleground', id: 'meadow' }));
await wait(150);
check('two of three voted, still open', state(host).chosen === null);

// The judge is the third voter: the brief gives them a say.
j.send(JSON.stringify({ type: 'voteBattleground', id: 'meadow' }));
await wait(250);
s = state(host);
check('the judge closes the vote', s.chosen !== null, String(s.chosen));
check('draws only from what was picked', s.chosen === 'meadow', String(s.chosen));
check('the result is held before the battle', s.phase === 'battleground', s.phase);
check('the hold has a deadline', s.stepEndsAt > Date.now());

for (const ws of [host, a, b, j]) ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
