/**
 * Room server integration tests.
 *
 * Drives a live PartyKit room over raw WebSockets — start the party first:
 *
 *   npm run dev:party      # terminal 1
 *   npm run test:room      # terminal 2
 *
 * Covers the rules that matter for trust: only the host assigns teams, start
 * is refused while anyone is unassigned, and a mid-game disconnect keeps the
 * player's seat rather than dropping their drawings.
 */
// Drives the PartyKit room over raw WebSockets: host opens, two phones join,
// host assigns teams, host starts.
const ROOM = 'TSTX';
const URL = `ws://127.0.0.1:1999/parties/main/${ROOM}`;

const open = (label) => new Promise((resolve, reject) => {
  const ws = new WebSocket(URL);
  ws.label = label;
  ws.inbox = [];
  ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
  ws.addEventListener('open', () => resolve(ws));
  ws.addEventListener('error', reject);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (ws, type) => [...ws.inbox].reverse().find((m) => m.type === type);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const host = await open('host');
host.send(JSON.stringify({ type: 'host', capacity: 2 }));
await wait(250);

const welcome = last(host, 'welcome');
check('host gets welcome', !!welcome);
check('room code matches', welcome?.state.code === ROOM, welcome?.state.code);
check('capacity recorded', welcome?.state.capacity === 2);

const a = await open('a');
a.send(JSON.stringify({ type: 'join', name: 'Blobbo' }));
const b = await open('b');
b.send(JSON.stringify({ type: 'join', name: 'Squish' }));
await wait(300);

const state = last(host, 'state').state;
const players = state.players.filter((p) => !p.isHost);
check('both players joined', players.length === 2, JSON.stringify(players.map(p=>p.name)));
check('host sees them broadcast', players.map((p) => p.name).sort().join() === 'Blobbo,Squish');
check('players start unassigned', players.every((p) => p.role === 'unassigned'));

// Duplicate names get disambiguated rather than colliding.
const c = await open('c');
c.send(JSON.stringify({ type: 'join', name: 'Blobbo' }));
await wait(250);
const names = last(host, 'state').state.players.filter((p) => !p.isHost).map((p) => p.name);
check('duplicate name disambiguated', names.includes('Blobbo 2'), JSON.stringify(names));

// A phone must not be able to assign teams.
a.send(JSON.stringify({ type: 'setRole', playerId: players[0].id, role: 'teamA' }));
await wait(200);
check('non-host cannot assign roles', !!last(a, 'error'), JSON.stringify(last(a,'error')));

// Start is refused while anyone is unassigned.
host.send(JSON.stringify({ type: 'start' }));
await wait(200);
check('start blocked while unassigned', last(host, 'error')?.reason?.includes('place'));

// Host assigns everyone, then starts.
const ids = last(host, 'state').state.players.filter((p) => !p.isHost).map((p) => p.id);
host.send(JSON.stringify({ type: 'setRole', playerId: ids[0], role: 'teamA' }));
host.send(JSON.stringify({ type: 'setRole', playerId: ids[1], role: 'teamB' }));
host.send(JSON.stringify({ type: 'setRole', playerId: ids[2], role: 'judge' }));
await wait(250);
host.send(JSON.stringify({ type: 'start' }));
await wait(250);
check('phase advances on start', last(host, 'state').state.phase === 'characters',
  last(host, 'state').state.phase);
check('phones see the phase change', last(a, 'state').state.phase === 'characters');

// A phone dropping in the lobby frees its seat.
c.close();
await wait(300);
const after = last(host, 'state').state.players.filter((p) => !p.isHost);
check('disconnect mid-game keeps the seat', after.length === 3 && after.some((p) => !p.connected),
  JSON.stringify(after.map((p) => [p.name, p.connected])));

for (const ws of [host, a, b]) ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
