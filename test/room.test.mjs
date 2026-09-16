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
import { PNG } from './creation-helper.mjs';
import { GRACE_SECONDS } from './protocol.mjs';
// Drives the PartyKit room over raw WebSockets: host opens, two phones join,
// host assigns teams, host starts.
// A fresh room per run: PartyKit keeps a room alive between runs, so a fixed
// id means the second run meets a room that already has a host and every
// assertion after that cascades.
const ROOM = 'TSTX' + Math.floor(Math.random() * 900 + 100);
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
check('phase advances on start', last(host, 'state').state.phase === 'creating',
  last(host, 'state').state.phase);
check('phones see the phase change', last(a, 'state').state.phase === 'creating');

// A phone dropping in the lobby frees its seat.
c.close();
await wait(300);
const after = last(host, 'state').state.players.filter((p) => !p.isHost);
check('disconnect mid-game keeps the seat', after.length === 3 && after.some((p) => !p.connected),
  JSON.stringify(after.map((p) => [p.name, p.connected])));

for (const ws of [host, a, b]) ws.close();
// --- a code that names no game --------------------------------------------
//
// Every four-letter code is a room the platform will create on demand, so a
// typo does not fail: it opens an empty room and leaves the player waiting in
// it for people who are somewhere else entirely.
{
  const stray = 'NON' + Math.floor(Math.random() * 900 + 100);
  const lost = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:1999/parties/main/${stray}?_pk=lost`);
    ws.inbox = [];
    ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
    ws.addEventListener('open', () => resolve(ws));
  });
  lost.send(JSON.stringify({ type: 'join', name: 'Lost' }));
  await wait(500);

  const said = lost.inbox.filter((m) => m.type === 'error').map((m) => m.reason);
  check('joining a room nobody hosts is refused', said.length === 1, JSON.stringify(said));
  check('and says which letters to check',
    /check the letters/i.test(said[0] ?? ''), said[0]);

  const after = [...lost.inbox].reverse().find((m) => m.type === 'state')?.state;
  check('the player is not left sitting in an empty room',
    !after?.players.some((p) => p.name === 'Lost'),
    JSON.stringify(after?.players.map((p) => p.name)));
  lost.close();
}

// --- a phone that sleeps and wakes ----------------------------------------
//
// A disconnect used to remove the player on the spot, which is right for
// someone who closes the tab for good and wrong for a phone that locked in
// someone's hand. Now the room waits out a grace period before deciding which
// it was. This sits through a real one rather than faking the clock, because
// the waiting is the thing being tested.
{
  const code = 'WAKE' + Math.floor(Math.random() * 900 + 100);
  const socket = (id) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:1999/parties/main/${code}?_pk=${id}`);
    ws.inbox = [];
    ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
    ws.addEventListener('open', () => resolve(ws));
  });
  const seen = (ws) => [...ws.inbox].reverse()
    .find((m) => m.type === 'state' || m.type === 'welcome')?.state;

  const screen = await socket('screen');
  screen.send(JSON.stringify({ type: 'host', capacity: 2 }));
  await wait(300);

  let phone = await socket('phone');
  phone.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  await wait(400);
  check('the phone is in the room', seen(screen).players.some((p) => p.name === 'Ann'));

  phone.close();
  await wait(600);
  check('sleeping in the lobby keeps the seat',
    seen(screen).players.some((p) => p.name === 'Ann'),
    JSON.stringify(seen(screen).players.map((p) => p.name)));
  check('and shows them as away',
    seen(screen).players.find((p) => p.name === 'Ann')?.connected === false);

  // Waking: the same device id, saying who it is again.
  phone = await socket('phone');
  phone.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  await wait(400);
  check('waking puts them back in the room',
    seen(screen).players.some((p) => p.name === 'Ann'),
    JSON.stringify(seen(screen).players.map((p) => p.name)));
  check('with the countdown called off',
    seen(screen).players.find((p) => p.name === 'Ann')?.leftAt === 0);
  check('and not twice',
    seen(screen).players.filter((p) => p.name.startsWith('Ann')).length === 1,
    JSON.stringify(seen(screen).players.map((p) => p.name)));
  check('the phone can see the room too',
    seen(phone)?.players.length === 2, JSON.stringify(seen(phone)?.players.map((p) => p.name)));

  // Pressing Leave is not the same as a socket going quiet: it says outright
  // what a dropped connection can only be guessed at, so there is nothing to
  // wait for. Without this the lobby held a ghost marked "reconnecting…" for
  // twenty-five seconds and went on counting it towards the players it was
  // waiting on.
  phone.send(JSON.stringify({ type: 'leave' }));
  await wait(600);
  check('leaving on purpose frees the seat at once',
    !seen(screen).players.some((p) => p.name === 'Ann'),
    JSON.stringify(seen(screen).players.map((p) => p.name)));
  phone.close();
  await wait(300);

  // And a seat that was never given up still waits out its grace.
  phone = await socket('phone');
  phone.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  await wait(400);
  check('and rejoining after that is a plain join',
    seen(screen).players.some((p) => p.name === 'Ann'),
    JSON.stringify(seen(screen).players.map((p) => p.name)));

  phone.close();
  await wait(GRACE_SECONDS * 1000 + 2000);
  check('a seat left long enough is given up',
    !seen(screen).players.some((p) => p.name === 'Ann'),
    JSON.stringify(seen(screen).players.map((p) => p.name)));
  check('but the room itself survives it',
    seen(screen).players.some((p) => p.isHost));

  for (const ws of [screen, phone]) ws.close();
}

// --- the host can remove somebody -------------------------------------------
//
// Somebody joins twice by accident, or a stranger wanders in off a shared
// link. Before the game starts that is a lobby problem with a lobby answer;
// afterwards a room that can delete a player can delete their work, so it
// stops being allowed.
{
  const code = 'KICK' + Math.floor(Math.random() * 900 + 100);
  const socket = (id) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:1999/parties/main/${code}?_pk=${id}`);
    ws.inbox = [];
    ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
    ws.addEventListener('open', () => resolve(ws));
  });
  const seen = (ws) => [...ws.inbox].reverse()
    .find((m) => m.type === 'state' || m.type === 'welcome')?.state;

  const screen = await socket('screen');
  screen.send(JSON.stringify({ type: 'host', capacity: 4 }));
  await wait(300);

  const ann = await socket('ann');
  ann.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  const bo = await socket('bo');
  bo.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  await wait(500);

  const ids = Object.fromEntries((seen(screen)?.players ?? [])
    .filter((p) => !p.isHost).map((p) => [p.name, p.id]));
  check('two players are in', Object.keys(ids).length === 2, JSON.stringify(ids));

  // A player cannot remove anybody, including themselves.
  ann.send(JSON.stringify({ type: 'kick', playerId: ids['Bo'] }));
  await wait(350);
  check('a player cannot remove anyone',
    seen(screen)?.players.some((p) => p.name === 'Bo'),
    JSON.stringify(seen(screen)?.players.map((p) => p.name)));

  screen.send(JSON.stringify({ type: 'kick', playerId: ids['Bo'] }));
  await wait(400);
  check('the host can', !seen(screen)?.players.some((p) => p.name === 'Bo'),
    JSON.stringify(seen(screen)?.players.map((p) => p.name)));
  check('and the one who stayed is untouched',
    seen(screen)?.players.some((p) => p.name === 'Ann'));
  check('the removed device is told why',
    bo.inbox.some((m) => m.type === 'error' && /removed you/i.test(m.reason)),
    JSON.stringify(bo.inbox.map((m) => m.type)));

  // Being removed fixes a mistake; it is not a ban.
  const again = await socket('bo2');
  again.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  await wait(400);
  check('and can come back', seen(screen)?.players.some((p) => p.name === 'Bo'),
    JSON.stringify(seen(screen)?.players.map((p) => p.name)));

  // The host is not a player and cannot be removed, or the room would vanish.
  const hostId = seen(screen)?.players.find((p) => p.isHost)?.id;
  screen.send(JSON.stringify({ type: 'kick', playerId: hostId }));
  await wait(300);
  check('the host cannot remove itself',
    seen(screen)?.players.some((p) => p.isHost));

  // Once people have made things, their seat stops being the host's to take.
  screen.send(JSON.stringify({ type: 'start' }));
  await wait(400);
  const playing = seen(screen)?.players.find((p) => p.name === 'Ann')?.id;
  screen.send(JSON.stringify({ type: 'kick', playerId: playing }));
  await wait(350);
  check('nobody can be removed once the game has started',
    seen(screen)?.players.some((p) => p.name === 'Ann'),
    JSON.stringify(seen(screen)?.players.map((p) => p.name)));

  for (const ws of [screen, ann, bo, again]) ws.close();
}

// --- two players are not two teams ----------------------------------------
{
  const code = 'DUEL' + Math.floor(Math.random() * 900 + 100);
  const socket = (id) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:1999/parties/main/${code}?_pk=${id}`);
    ws.inbox = [];
    ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
    ws.addEventListener('open', () => resolve(ws));
  });
  const seen = (ws) => [...ws.inbox].reverse()
    .find((m) => m.type === 'state' || m.type === 'welcome')?.state;

  const screen = await socket('screen');
  screen.send(JSON.stringify({ type: 'host', capacity: 2 }));
  await wait(300);
  const one = await socket('one');
  one.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  const two = await socket('two');
  two.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  await wait(500);

  check('nobody has been put anywhere',
    seen(screen).players.filter((p) => p.role === 'unassigned' && !p.isHost).length === 2);

  // No dragging, no teams: press start.
  screen.send(JSON.stringify({ type: 'start' }));
  await wait(500);
  const s = seen(screen);
  check('a duel starts with nobody assigned', s.phase === 'creating', s.phase);
  check('and puts the two of them opposite each other',
    s.players.filter((p) => p.role === 'teamA').length === 1
    && s.players.filter((p) => p.role === 'teamB').length === 1,
    JSON.stringify(s.players.map((p) => [p.name, p.role])));
  check('the sides take their own names',
    s.teamNames.teamA === 'Ann' && s.teamNames.teamB === 'Bo',
    JSON.stringify(s.teamNames));

  for (const ws of [screen, one, two]) ws.close();
}

// --- coming back after closing the tab -------------------------------------
//
// A phone that locks keeps its id and is recognised by it. A tab that is
// closed and reopened is a stranger on the wire, so the name is all there is
// to go on — and it is enough, because the seat is taken, its owner is not
// connected, and nobody else is using that name.
{
  const code = 'BACK' + Math.floor(Math.random() * 900 + 100);
  const socket = (id) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:1999/parties/main/${code}?_pk=${id}`);
    ws.inbox = [];
    ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
    ws.addEventListener('open', () => resolve(ws));
  });
  const seen = (ws) => [...ws.inbox].reverse()
    .find((m) => m.type === 'state' || m.type === 'welcome')?.state;

  const screen = await socket('screen');
  screen.send(JSON.stringify({ type: 'host', capacity: 2 }));
  await wait(300);
  const one = await socket('one');
  one.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  let two = await socket('two');
  two.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  await wait(450);

  const boId = seen(screen).players.find((p) => p.name === 'Bo').id;
  screen.send(JSON.stringify({ type: 'start' }));
  await wait(300);
  two.send(JSON.stringify({
    type: 'submitDrawing', slot: 'character', png: PNG, done: true,
  }));
  two.send(JSON.stringify({ type: 'submitName', slot: 'character', name: 'Sir Bo' }));
  await wait(400);

  // The tab is closed, not just locked: a new id entirely.
  two.close();
  await wait(500);
  two = await socket('bo-reopened');
  two.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  await wait(600);

  const after = seen(screen);
  const bo = after.players.find((p) => p.name === 'Bo');
  check('a reopened tab gets its seat back', bo?.connected === true, JSON.stringify(bo?.connected));
  check('and there is still only one of them',
    after.players.filter((p) => p.name === 'Bo').length === 1);
  check('their work came with them', bo?.characterName === 'Sir Bo', bo?.characterName);
  check('the seat now answers to the new device', bo?.id !== boId, `${boId} -> ${bo?.id}`);
  check('and they can see the room', Boolean(seen(two)?.players?.length));

  // Somebody who was never here is still turned away.
  const stranger = await socket('stranger');
  stranger.send(JSON.stringify({ type: 'join', name: 'Cal' }));
  await wait(400);
  const refusal = stranger.inbox.filter((m) => m.type === 'error').map((m) => m.reason);
  check('a stranger is still refused', refusal.length === 1, JSON.stringify(refusal));
  check('and told how to rejoin if they were here',
    /use the name you had/i.test(refusal[0] ?? ''), refusal[0]);

  for (const ws of [screen, one, two, stranger]) ws.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
