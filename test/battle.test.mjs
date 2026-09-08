/**
 * Artwork handover tests.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * Artwork is the one thing deliberately kept out of the broadcast state, so
 * these check the exception holds: only the host can pull it, it comes back
 * paired with its names, and a slot left blank still yields a usable weapon.
 */
const ROOM = 'BTX' + Math.floor(Math.random() * 9000 + 1000);
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
host.send(JSON.stringify({ type: 'host', capacity: 2 }));
await wait(200);
const a = await open(); a.send(JSON.stringify({ type: 'join', name: 'Ann' }));
const b = await open(); b.send(JSON.stringify({ type: 'join', name: 'Bo' }));
await wait(300);

const ids = state(host).players.filter((p) => !p.isHost).map((p) => p.id);
host.send(JSON.stringify({ type: 'setRole', playerId: ids[0], role: 'teamA' }));
host.send(JSON.stringify({ type: 'setRole', playerId: ids[1], role: 'teamB' }));
await wait(200);
host.send(JSON.stringify({ type: 'start' }));
await wait(250);

// Ann does everything; Bo draws a character but never names a weapon.
const steps = [
  ['submitDrawing', 'character'], ['submitName', 'character'],
  ['submitDrawing', 'weapon0'], ['submitName', 'weapon0'],
  ['submitDrawing', 'weapon1'], ['submitName', 'weapon1'],
  ['submitDrawing', 'weapon2'], ['submitName', 'weapon2'],
];
for (const [type, slot] of steps) {
  const payload = type === 'submitDrawing'
    ? { type, slot, png: PNG, done: true }
    : { type, slot, name: `Ann ${slot}` };
  a.send(JSON.stringify(payload));
  // Bo submits a drawing but leaves every name blank.
  b.send(JSON.stringify(type === 'submitDrawing'
    ? { type, slot, png: PNG, done: true }
    : { type, slot, name: '' }));
  await wait(90);
}
await wait(300);

check('creation finished', state(host).phase === 'battleground', state(host).phase);

// A phone must not be able to pull the artwork.
// A phone gets its own artwork — its move screen shows each weapon as the
// player drew it — and nobody else's.
a.send(JSON.stringify({ type: 'requestArt' }));
await wait(250);
const mine = last(a, 'art')?.art;
check('a phone receives its own artwork', Array.isArray(mine) && mine.length === 1,
  JSON.stringify(mine?.length));
check('and only its own', mine?.[0]?.playerId === ids[0], mine?.[0]?.playerId);
check('with the weapons it drew', mine?.[0]?.weapons.length === 3,
  String(mine?.[0]?.weapons.length));

host.send(JSON.stringify({ type: 'requestArt' }));
await wait(300);
// Artwork arrives one player at a time: everyone's together would be several
// megabytes, and the platform closes a socket carrying a message over one.
const artMessages = host.inbox.filter((m) => m.type === 'art');
const art = artMessages.flatMap((m) => m.art);
check('artwork comes one player per message',
  artMessages.length === 2 && artMessages.every((m) => m.art.length === 1),
  `${artMessages.length} messages`);
check('the host receives artwork', Array.isArray(art) && art.length === 2, JSON.stringify(art?.length));
check('and no single message is near the platform limit',
  artMessages.every((m) => JSON.stringify(m).length < 1_048_576),
  JSON.stringify(artMessages.map((m) => JSON.stringify(m).length)));

const ann = art?.find((x) => x.playerId === ids[0]);
check('a character comes back', Boolean(ann?.character), JSON.stringify(ann?.character?.name));
check('with the name given', ann?.character?.name === 'Ann character', ann?.character?.name);
check('all three weapons come back', ann?.weapons.length === 3, String(ann?.weapons.length));
check('weapons keep their order', ann?.weapons[0]?.name === 'Ann weapon0', ann?.weapons[0]?.name);

const bo = art?.find((x) => x.playerId === ids[1]);
check('a blank name falls back', bo?.character?.name === 'Nameless', bo?.character?.name);
check('blank weapons fall back to the standard three',
  bo?.weapons.map((w) => w.name).join() === 'Sword,Axe,Hammer',
  bo?.weapons.map((w) => w.name).join());

for (const ws of [host, a, b]) ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
