/**
 * What happens when a game ends.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * Three ways out of a finished fight: a rematch with the same characters, a
 * new game from scratch, and closing the room. Only the host chooses, and the
 * choice reaches every device — but a player is told rather than dragged.
 */
let room = '';
const freshRoom = () => { room = 'END' + Math.floor(Math.random() * 900000 + 100000); };
const url = (id) => `ws://127.0.0.1:1999/parties/main/${room}${id ? `?_pk=${id}` : ''}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const open = (id) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url(id));
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

freshRoom();
const host = await open('host');
host.send(JSON.stringify({ type: 'host', capacity: 2 }));
await wait(250);
const a = await open('ann');
a.send(JSON.stringify({ type: 'join', name: 'Ann' }));
const b = await open('bo');
b.send(JSON.stringify({ type: 'join', name: 'Bo' }));
await wait(350);

const ids = state(host).players.filter((p) => !p.isHost).map((p) => p.id);
host.send(JSON.stringify({ type: 'setRole', playerId: ids[0], role: 'teamA' }));
host.send(JSON.stringify({ type: 'setRole', playerId: ids[1], role: 'teamB' }));
await wait(200);
host.send(JSON.stringify({ type: 'start' }));
await wait(250);

// Make something, so there is something for a new game to clear away.
a.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG, done: true }));
b.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG, done: true }));
await wait(450);
a.send(JSON.stringify({ type: 'submitName', slot: 'character', name: 'Sir Bonkalot' }));
b.send(JSON.stringify({ type: 'submitName', slot: 'character', name: 'Deserter' }));
await wait(500);
check('a character was made', state(host).players.some((p) => p.characterName === 'Sir Bonkalot'),
  JSON.stringify(state(host).players.map((p) => p.characterName)));

// Only the host decides.
a.send(JSON.stringify({ type: 'newGame' }));
await wait(250);
check('a player cannot start a new game',
  state(host).players.some((p) => p.characterName === 'Sir Bonkalot'));

host.send(JSON.stringify({ type: 'newGame' }));
await wait(400);
const fresh = state(host);
check('a new game returns to creation', fresh.phase === 'creating', fresh.phase);
check('at the first step', fresh.step === 0, String(fresh.step));
check('on a fresh clock', fresh.stepEndsAt > Date.now());
check('with nothing kept from the last game',
  fresh.players.every((p) => p.characterName === '' && p.weaponNames.length === 0),
  JSON.stringify(fresh.players.map((p) => [p.characterName, p.weaponNames.length])));
check('nobody still marked ready', !fresh.players.some((p) => p.progress.ready));
check('nobody carrying damage', fresh.players.every((p) => p.health === 100 && p.damageTaken === 0));
check('and no ULT owed', fresh.ultRound === 0, String(fresh.ultRound));

// The artwork itself has to go too, or the next game opens with the last
// game's drawings sitting behind it.
host.send(JSON.stringify({ type: 'requestArt' }));
await wait(300);
const art = host.inbox.filter((m) => m.type === 'art').flatMap((m) => m.art);
const stale = art.filter((entry) => entry.character?.name === 'Sir Bonkalot');
check('the old artwork is gone', stale.length === 0, JSON.stringify(stale.map((s) => s.character?.name)));

// Closing the room reaches every device.
const closed = [];
for (const ws of [a, b]) {
  ws.addEventListener('message', (e) => {
    if (JSON.parse(e.data).type === 'closed') closed.push(true);
  });
}
a.send(JSON.stringify({ type: 'closeRoom' }));
await wait(250);
check('a player cannot close the room', closed.length === 0, String(closed.length));

host.send(JSON.stringify({ type: 'closeRoom' }));
await wait(600);
check('the host closing tells every device', closed.length === 2, String(closed.length));

for (const ws of [host, a, b]) ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
