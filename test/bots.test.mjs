/**
 * Disconnection and bot-takeover tests.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * The brief's rule: a player who drops keeps whatever they had drawn, a bot
 * fights for them, and anything they never made becomes a stand-in Sword, Axe
 * or Hammer. Reconnecting hands the fighter straight back.
 */
let room = '';
const freshRoom = () => { room = 'BOT' + Math.floor(Math.random() * 900000 + 100000); };
const url = () => `ws://127.0.0.1:1999/parties/main/${room}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const open = (id) => new Promise((resolve, reject) => {
  const ws = new WebSocket(id ? `${url()}?_pk=${id}` : url());
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

// A room where Bo drops out during creation, having drawn only a character.
freshRoom();
const host = await open();
host.send(JSON.stringify({ type: 'host', capacity: 2 }));
await wait(200);
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

// Both draw a character; Bo names theirs and then vanishes.
a.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG, done: true }));
b.send(JSON.stringify({ type: 'submitDrawing', slot: 'character', png: PNG, done: true }));
await wait(300);
a.send(JSON.stringify({ type: 'submitName', slot: 'character', name: 'Sir Bonkalot' }));
b.send(JSON.stringify({ type: 'submitName', slot: 'character', name: 'Deserter' }));
await wait(300);

b.close();
await wait(300);
check('a dropped player keeps their seat',
  state(host).players.some((p) => p.id === ids[1]), JSON.stringify(state(host).players.map((p) => p.id)));
check('and is marked as gone',
  state(host).players.find((p) => p.id === ids[1])?.connected === false);

// Ann finishes the rest on her own; the room must not wait on a ghost.
for (let i = 0; i < 14; i++) {
  a.send(JSON.stringify({ type: 'submitDrawing', slot: `weapon${Math.floor(i / 2)}`, png: PNG, done: true }));
  a.send(JSON.stringify({ type: 'ready' }));
  await wait(90);
  if (state(host).phase !== 'creating') break;
}
await wait(200);
check('a room with one player left still reaches the vote',
  state(host).phase === 'battleground', state(host).phase);

a.send(JSON.stringify({ type: 'voteBattleground', id: 'sky' }));
await wait(4800);
check('and the battle starts', state(host).phase === 'battle', state(host).phase);

const filled = state(host).players.find((p) => p.id === ids[1]);
check('what they drew survives', filled.progress.drawn.includes('character'));
check('what they named survives', filled.characterName === 'Deserter', filled.characterName);
check('the weapons they never drew are filled in',
  ['weapon0', 'weapon1', 'weapon2'].every((s) => filled.progress.drawn.includes(s)),
  JSON.stringify(filled.progress.drawn));
check('and named Sword, Axe and Hammer',
  JSON.stringify(filled.weaponNames) === JSON.stringify(['Sword', 'Axe', 'Hammer']),
  JSON.stringify(filled.weaponNames));

// The host asks for artwork: the absent player's must be complete.
host.send(JSON.stringify({ type: 'requestArt' }));
await wait(300);
const art = host.inbox.filter((m) => m.type === 'art')
  .flatMap((m) => m.art)
  .find((entry) => entry.playerId === ids[1]);
check('their artwork is whole', art?.character !== null && art?.weapons.length === 3,
  JSON.stringify(art?.weapons?.length));
check('the stand-in weapons point at real files',
  art?.weapons.every((w) => w.png.startsWith('/placeholder-') || w.png.startsWith('data:')),
  JSON.stringify(art?.weapons.map((w) => w.png)));

// A bot writes for them when the move clock closes.
a.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'a real players swing' }));
await wait(400);
const turn = state(host).turn;
check('the bot took the absent player’s turn', turn?.phase === 'playing', turn?.phase);
check('and wrote something usable',
  (turn?.moves[ids[1]]?.prompt ?? '').split(' ').length > 3,
  turn?.moves[ids[1]]?.prompt);
check('with a weapon they own',
  turn?.moves[ids[1]]?.weapon >= 0 && turn?.moves[ids[1]]?.weapon < 3,
  String(turn?.moves[ids[1]]?.weapon));

// Coming back reclaims the seat.
const back = await open('bo');
await wait(400);
check('a returning player is connected again',
  state(host).players.find((p) => p.connected === false) === undefined,
  JSON.stringify(state(host).players.map((p) => [p.name, p.connected])));

for (const ws of [host, a, back]) ws.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
