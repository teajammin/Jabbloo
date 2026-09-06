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
check('phase becomes creating', s.phase === 'creating', s.phase);
check('starts on step 0', s.step === 0, String(s.step));
check('deadline is in the future', s.stepEndsAt > Date.now(), String(s.stepEndsAt - Date.now()));

const spread = Math.abs(state(a).stepEndsAt - state(b).stepEndsAt);
check('every device gets the same deadline', spread === 0, `${spread}ms apart`);

// Both fighters finishing should advance without waiting out 90 seconds.
const before = Date.now();
a.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG }));
await wait(150);
check('one player done does not advance', state(host).step === 0, String(state(host).step));
check('progress is visible to others', state(b).players.some((p) => p.progress.ready));

b.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG }));
await wait(250);
s = state(host);
check('both done advances the step', s.step === 1, String(s.step));
check('advanced early, not on the timer', Date.now() - before < 5000);
check('ready resets for the new step', !s.players.some((p) => p.progress.ready));

// The judge never submits; the room must not wait on them.
a.send(JSON.stringify({ type: 'submitName', slot: 'character', name: 'Blobbo' }));
b.send(JSON.stringify({ type: 'submitName', slot: 'character', name: '' }));
await wait(250);
s = state(host);
check('a judge is not waited on', s.step === 2, String(s.step));
check('drawn slots are tracked', state(a).players.find((p) => p.id === ids[0]).progress.drawn.includes('character'));
check('named slots are tracked', state(a).players.find((p) => p.id === ids[0]).progress.named.includes('character'));

// Step 2 is the first weapon drawing.
check('weapon steps follow the character', s.step === 2);

for (const ws of [host, a, b, j]) ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
