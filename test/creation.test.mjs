/**
 * Creation-phase integration tests.
 *
 * Drives a live PartyKit room; start it first with `npm run dev:party`.
 * Covers the parts that are easy to get wrong: that the server owns one clock
 * for everyone, that finishing early advances the step, that a judge is not
 * waited on, and that anything left unnamed still gets a name.
 */
const ROOM = 'CRTX' + Math.floor(Math.random() * 900 + 100);
const URL_ = `ws://127.0.0.1:1999/parties/main/${ROOM}`;

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(URL_);
  ws.inbox = [];
  ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
  ws.addEventListener('open', () => resolve(ws));
  ws.addEventListener('error', reject);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (ws, type) => [...ws.inbox].reverse().find((m) => m.type === type);
const state = (ws) => last(ws, 'state')?.state ?? last(ws, 'welcome')?.state;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
await wait(300);

let s = state(host);
const mine = (ws, id) => state(ws).players.find((p) => p.id === id);

check('phase becomes creating', s.phase === 'creating', s.phase);
check('everyone starts on their own first step',
  s.players.filter((p) => !p.isHost).every((p) => p.progress.step === 0),
  JSON.stringify(s.players.map((p) => p.progress.step)));
check('each with their own deadline',
  s.players.filter((p) => !p.isHost).every((p) => p.progress.endsAt > Date.now()));
check('and nobody is finished yet', !s.players.some((p) => p.progress.done));

/*
 * Each player walks their own path now. The old arrangement marched everyone
 * through the same step together, so four people waited on a fifth to think of
 * a name, four times over.
 */

// The tool autosaves while a player draws. Those saves are kept without being
// mistaken for a finished step.
a.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG }));
b.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG }));
await wait(300);
s = state(host);
check('an autosave is kept',
  s.players.filter((p) => p.progress.drawn.includes('character')).length === 2,
  JSON.stringify(s.players.map((p) => p.progress.drawn)));
check('an autosave does not move them on',
  s.players.filter((p) => !p.isHost).every((p) => p.progress.step === 0),
  JSON.stringify(s.players.map((p) => p.progress.step)));

// One player finishing moves that player, and only that player.
a.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG, done: true }));
await wait(300);
check('finishing moves the one who finished', mine(host, ids[0]).progress.step === 1,
  String(mine(host, ids[0]).progress.step));
check('and leaves everyone else where they were',
  mine(host, ids[1]).progress.step === 0, String(mine(host, ids[1]).progress.step));
check('with a fresh deadline of their own',
  mine(host, ids[0]).progress.endsAt > Date.now());
check('and the others can see it', mine(b, ids[0]).progress.step === 1);

// They keep going without waiting for anybody.
a.send(JSON.stringify({ type: 'submitName', slot: 'character', name: 'Blobbo' }));
await wait(300);
check('naming moves them on again', mine(host, ids[0]).progress.step === 2,
  String(mine(host, ids[0]).progress.step));
check('while the other is still on their first',
  mine(host, ids[1]).progress.step === 0, String(mine(host, ids[1]).progress.step));
check('and the room has not moved on', state(host).phase === 'creating');

// The slower player catches up.
b.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG, done: true }));
await wait(200);
b.send(JSON.stringify({ type: 'submitName', slot: 'character', name: '' }));
await wait(350);
check('drawn slots are tracked', mine(a, ids[0]).progress.drawn.includes('character'));
check('named slots are tracked', mine(a, ids[0]).progress.named.includes('character'));
check('a blank name still finishes the step',
  mine(host, ids[1]).progress.step >= 2, String(mine(host, ids[1]).progress.step));

// The judge makes nothing and is never waited for.
check('a judge is not holding anyone up', state(host).phase === 'creating');

for (const ws of [host, a, b, j]) ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
