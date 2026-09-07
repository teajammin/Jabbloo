/**
 * Message-size tests.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * The platform does not reject an oversized message — it closes the socket
 * carrying it, code 1009. So a player who attached a phone photo lost their
 * connection mid-join and came back as nobody: present on their own screen,
 * absent from everyone else's. These check the limit is real, that the room
 * stays under it, and that a photo cannot cost a player their seat.
 */
// Hardcoded rather than imported: this suite runs unbundled, and the protocol
// module reaches into the engine for the battleground list. test/protocol
// asserts these are the same numbers the game is built against.
const MAX_MESSAGE_BYTES = 1_048_576;
const MAX_PHOTO_BYTES = 120_000;

let room = '';
const freshRoom = () => { room = 'LIM' + Math.floor(Math.random() * 900000 + 100000); };
const url = (id) => `ws://127.0.0.1:1999/parties/main/${room}${id ? `?_pk=${id}` : ''}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const open = (id) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url(id));
  ws.inbox = [];
  ws.closed = null;
  ws.errored = null;
  ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
  ws.addEventListener('close', (e) => { ws.closed = { code: e.code, reason: e.reason }; });
  ws.addEventListener('open', () => resolve(ws));
  // Recorded rather than thrown: a socket killed for an oversized message
  // fires this, and it is the thing under test, not a broken test.
  ws.addEventListener('error', (e) => {
    ws.errored = e;
    reject(e);
  });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.type === t);
const state = (ws) => last(ws, 'state')?.state ?? last(ws, 'welcome')?.state;

// A socket closed for an oversized message reports an error after it has
// already opened, which Node would otherwise treat as a crash.
process.on('unhandledRejection', () => {});
process.on('uncaughtException', (error) => {
  if (!/too large|1009|WebSocket/i.test(String(error?.message))) throw error;
});

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

/** A data URL of roughly this many bytes. */
const fakePhoto = (bytes) => `data:image/jpeg;base64,${'A'.repeat(Math.max(0, bytes - 23))}`;

freshRoom();
const host = await open('host');
host.send(JSON.stringify({ type: 'host', capacity: 3 }));
await wait(300);

// The limit is the platform's, not ours, so it is worth proving it exists
// rather than trusting a number written in a constant.
{
  const doomed = await open('doomed');
  doomed.send(JSON.stringify({
    type: 'join', name: 'TooBig', photo: fakePhoto(MAX_MESSAGE_BYTES + 200_000),
  }));
  await wait(1200);
  check('an oversized message closes the socket', doomed.closed !== null,
    JSON.stringify(doomed.closed));
  check('and it is the size the platform complains about',
    (doomed.closed?.reason ?? '').toLowerCase().includes('too large'),
    doomed.closed?.reason);
  check('the room carries on regardless', state(host)?.phase === 'lobby');
}

// A photo within the client's own budget joins normally and is kept.
{
  const ok = await open('with-photo');
  ok.send(JSON.stringify({
    type: 'join', name: 'Photo', photo: fakePhoto(Math.floor(MAX_PHOTO_BYTES * 0.5)),
  }));
  await wait(400);
  const player = state(host)?.players.find((p) => p.name === 'Photo');
  check('a photo within budget joins', Boolean(player), JSON.stringify(state(host)?.players.map((p) => p.name)));
  check('and keeps its photo', typeof player?.photo === 'string');
  ok.close();
}

// One that slipped past the client is dropped — the seat matters, the avatar
// does not. A stored oversized photo would ride along in every state update
// from then on, closing everyone's socket rather than just the sender's.
{
  const chancer = await open('chancer');
  chancer.send(JSON.stringify({
    type: 'join', name: 'Chancer', photo: fakePhoto(MAX_PHOTO_BYTES * 3),
  }));
  await wait(400);
  const player = state(host)?.players.find((p) => p.name === 'Chancer');
  check('an oversized photo still joins the player', Boolean(player));
  check('but the photo itself is dropped', player?.photo === undefined,
    String(player?.photo?.length));
  chancer.close();
}

// Every state broadcast has to stay under the limit, since one that does not
// disconnects the whole room at once rather than one player.
{
  const size = JSON.stringify(last(host, 'state') ?? {}).length;
  check('a state broadcast stays well clear of the limit',
    size < MAX_MESSAGE_BYTES / 4, `${size} bytes`);
}

host.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
