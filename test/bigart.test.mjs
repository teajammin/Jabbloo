/**
 * Artwork big enough to have closed the socket.
 *
 * A player who imports photographs can have more than a megabyte of PNG
 * between their character and their weapons. The platform does not reject a
 * message that size — it closes the socket carrying it — so sending somebody's
 * whole portfolio at once took the host's screen down at the exact moment the
 * battle started, and everyone whose artwork had not arrived fought as a
 * stand-in. It only ever happened to people playing with somebody who had used
 * the camera, which is why it looked like a problem with distance.
 *
 * Needs a live party: `npm run dev:party`.
 */
import { GROUND_IDS } from './grounds.mjs';
import { WEAPON_COUNT } from './protocol.mjs';

const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const room = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join('');
const url = () => `ws://127.0.0.1:1999/parties/main/${room}`;

const open = (id) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${url()}?_pk=${id}`);
  ws.inbox = [];
  ws.closedWith = null;
  ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
  ws.addEventListener('close', (e) => { ws.closedWith = e.code; });
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

/**
 * A PNG of about the size a photograph exports to.
 *
 * Not a real image — the server only checks the prefix, and what is being
 * tested is what the wire does with the weight of it.
 */
const heavy = (kb) =>
  'data:image/png;base64,' + 'A'.repeat(kb * 1024);

const host = await open('screen');
host.send(JSON.stringify({ type: 'host', capacity: 2 }));
await wait(300);
const a = await open('ann');
a.send(JSON.stringify({ type: 'join', name: 'Ann' }));
const b = await open('bo');
b.send(JSON.stringify({ type: 'join', name: 'Bo' }));
await wait(400);

host.send(JSON.stringify({ type: 'start' }));
await wait(300);

// Ann brings photographs: a character and every weapon, each near the export
// budget. Together they are well over what one message may carry.
const slots = ['character', ...Array.from({ length: WEAPON_COUNT }, (_, i) => `weapon${i}`)];
for (const slot of slots) {
  a.send(JSON.stringify({ type: 'submitDrawing', slot, png: heavy(600), done: true }));
  await wait(250);
  a.send(JSON.stringify({ type: 'submitName', slot, name: `Ann's ${slot}` }));
  await wait(250);
}
for (const slot of slots) {
  b.send(JSON.stringify({ type: 'submitDrawing', slot, png: heavy(4), done: true }));
  await wait(120);
  b.send(JSON.stringify({ type: 'submitName', slot, name: `Bo's ${slot}` }));
  await wait(120);
}
for (let i = 0; i < 60 && state(host)?.phase === 'creating'; i++) await wait(150);
check('a room full of photographs still reaches the vote',
  state(host)?.phase === 'battleground', state(host)?.phase);

host.send(JSON.stringify({ type: 'requestArt' }));
await wait(1200);

check('the host is still connected', host.closedWith === null,
  `socket closed with ${host.closedWith}`);

const pieces = host.inbox.filter((m) => m.type === 'art').flatMap((m) => m.art);
const annId = state(host)?.players.find((p) => p.name === 'Ann')?.id;
const mine = pieces.filter((p) => p.playerId === annId);

check('their artwork arrives in pieces', mine.length > 1, String(mine.length));
check('and no single message is near the limit',
  host.inbox.filter((m) => m.type === 'art')
    .every((m) => JSON.stringify(m).length < 1_048_576 * 0.95),
  String(Math.max(...host.inbox.filter((m) => m.type === 'art')
    .map((m) => JSON.stringify(m).length))));

const built = mine.reduce((into, piece) => {
  const weapons = into ? [...into.weapons] : [];
  for (const [offset, w] of piece.weapons.entries()) {
    weapons[w.index ?? weapons.length + offset] = w;
  }
  return { character: piece.character ?? into?.character ?? null, weapons };
}, null);

check('the character made it', Boolean(built?.character), JSON.stringify(built?.character));
check('and every weapon did',
  built?.weapons.filter(Boolean).length === WEAPON_COUNT,
  String(built?.weapons.filter(Boolean).length));
check('none of it is a stand-in',
  built?.character?.png.startsWith('data:image') === true
  && built?.weapons.every((w) => w?.png.startsWith('data:image')) === true,
  JSON.stringify(built?.weapons.map((w) => w?.png.slice(0, 20))));

// The other player's smaller artwork must be unaffected by all of that.
const boId = state(host)?.players.find((p) => p.name === 'Bo')?.id;
check("the other player's artwork arrived too",
  pieces.some((p) => p.playerId === boId && p.character));

void GROUND_IDS;
for (const ws of [host, a, b]) ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
