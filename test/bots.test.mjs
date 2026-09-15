/**
 * Disconnection and bot-takeover tests.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * The brief's rule: a player who drops keeps whatever they had drawn, a bot
 * fights for them, and anything they never made becomes a stand-in Sword, Axe
 * or Hammer. Reconnecting hands the fighter straight back.
 *
 * Nothing happens for the first twenty-five seconds, though, and that waiting
 * is the point: a locked phone must cost nobody their game. One block here
 * sits out a real grace period rather than faking the clock, because the thing
 * being tested is whether the server actually waits.
 */
import { GROUND_IDS } from './grounds.mjs';
import { GRACE_SECONDS, WEAPON_COUNT } from './protocol.mjs';

/** Named from the game's own count, so this suite follows it rather than leads. */
const WEAPON_SLOTS = Array.from({ length: WEAPON_COUNT }, (_, i) => `weapon${i}`);
const STAND_INS = ['Sword', 'Axe', 'Hammer'].slice(0, WEAPON_COUNT);
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
/** Sits out a real grace period, with a second's margin. */
const waitOutGrace = () => wait(GRACE_SECONDS * 1000 + 1000);
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
check('but is not written off straight away',
  state(host).players.find((p) => p.id === ids[1])?.progress.done === false,
  JSON.stringify(state(host).players.find((p) => p.id === ids[1])?.progress));

await waitOutGrace();
check('until the grace period runs out',
  state(host).players.find((p) => p.id === ids[1])?.progress.done === true,
  JSON.stringify(state(host).players.find((p) => p.id === ids[1])?.progress));

// Ann finishes the rest on her own; the room must not wait on a ghost.
for (let i = 0; i < 4 + WEAPON_COUNT * 4; i++) {
  a.send(JSON.stringify({ type: 'submitDrawing', slot: `weapon${Math.floor(i / 2)}`, png: PNG, done: true }));
  a.send(JSON.stringify({ type: 'ready' }));
  await wait(90);
  if (state(host).phase !== 'creating') break;
}
await wait(200);
check('a room with one player left still reaches the vote',
  state(host).phase === 'battleground', state(host).phase);

a.send(JSON.stringify({ type: 'voteBattleground', id: GROUND_IDS[0] }));
for (let i = 0; i < 90; i++) {
  if (state(host).phase === 'battle') break;
  await wait(120);
}
check('and the battle starts', state(host).phase === 'battle', state(host).phase);

const filled = state(host).players.find((p) => p.id === ids[1]);
check('what they drew survives', filled.progress.drawn.includes('character'));
check('what they named survives', filled.characterName === 'Deserter', filled.characterName);
check('the weapons they never drew are filled in',
  WEAPON_SLOTS.every((s) => filled.progress.drawn.includes(s)),
  JSON.stringify(filled.progress.drawn));
check('and named after the stand-ins',
  JSON.stringify(filled.weaponNames) === JSON.stringify(STAND_INS),
  JSON.stringify(filled.weaponNames));

// The host asks for artwork: the absent player's must be complete.
host.send(JSON.stringify({ type: 'requestArt' }));
await wait(300);
const art = host.inbox.filter((m) => m.type === 'art')
  .flatMap((m) => m.art)
  .find((entry) => entry.playerId === ids[1]);
check('their artwork is whole', art?.character !== null && art?.weapons.length === WEAPON_COUNT,
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
  turn?.moves[ids[1]]?.weapon >= 0 && turn?.moves[ids[1]]?.weapon < WEAPON_COUNT,
  String(turn?.moves[ids[1]]?.weapon));

// Coming back reclaims the seat.
const back = await open('bo');
await wait(400);
check('a returning player is connected again',
  state(host).players.find((p) => p.connected === false) === undefined,
  JSON.stringify(state(host).players.map((p) => [p.name, p.connected])));

for (const ws of [host, a, back]) ws.close();

// --- a phone that comes back mid-creation ----------------------------------
//
// Dropping out finishes a player early so the room is not held up by an empty
// chair. Coming back before the others have finished should undo that rather
// than leave them sitting out the rest of their own creation.
{
  freshRoom();
  const screen = await open('screen');
  screen.send(JSON.stringify({ type: 'host', capacity: 2 }));
  await wait(300);
  const one = await open('one');
  one.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  let two = await open('two');
  two.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  await wait(450);

  const pair = state(screen).players.filter((p) => !p.isHost).map((p) => p.id);
  screen.send(JSON.stringify({ type: 'start' }));
  await wait(350);

  two.close();
  await wait(1500);
  const gone = state(screen).players.find((p) => p.id === pair[1]);
  check('a phone that locks is not written off', gone?.progress.done === false,
    JSON.stringify(gone?.progress));
  check('and its clock is still running', (gone?.progress.endsAt ?? 0) > Date.now(),
    String(Math.round(((gone?.progress.endsAt ?? 0) - Date.now()) / 1000)) + 's');
  check('while the room keeps waiting for the one still drawing',
    state(screen).phase === 'creating', state(screen).phase);

  two = await open('two');
  await wait(600);
  const back = state(screen).players.find((p) => p.id === pair[1]);
  check('coming back inside the grace period keeps the seat',
    back?.connected === true && back?.leftAt === 0,
    JSON.stringify([back?.connected, back?.leftAt]));
  check('with nothing to catch up on', back?.progress.done === false,
    JSON.stringify(back?.progress));
  check('on the step they were on', back?.progress.step === 0, String(back?.progress.step));

  for (const ws of [screen, one, two]) ws.close();
}

// --- the host's screen blinks ----------------------------------------------
//
// The bug that prompted all of this: a disconnect in the lobby removed the
// player, host included, and a room whose host had been removed answered every
// join with "no game with that code". Players watched themselves land in the
// lobby and get thrown out of a game that was still running on the laptop in
// front of them.
{
  freshRoom();
  let screen = await open('screen');
  screen.send(JSON.stringify({ type: 'host', capacity: 2 }));
  await wait(300);

  const first = await open('ann');
  first.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  await wait(300);
  check('a player is in the lobby',
    state(screen).players.some((p) => p.name === 'Ann'), JSON.stringify(state(screen).players));

  screen.close();
  await wait(1200);

  // Somebody else joins while the big screen is away.
  const second = await open('bo');
  second.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  await wait(500);
  check('a blink of the host screen does not lose the room',
    last(second, 'error') === undefined, last(second, 'error')?.reason);
  check('and the join lands', state(second)?.players.some((p) => p.name === 'Bo'),
    JSON.stringify(state(second)?.players?.map((p) => p.name)));

  // And the host comes back to the same room rather than a new one.
  screen = await open('screen');
  screen.send(JSON.stringify({ type: 'host', capacity: 2 }));
  await wait(500);
  check('the host screen reclaims its own room',
    state(screen).players.filter((p) => p.isHost).length === 1,
    JSON.stringify(state(screen).players.map((p) => [p.name, p.isHost])));
  check('with everyone still in it',
    ['Ann', 'Bo'].every((n) => state(screen).players.some((p) => p.name === n)),
    JSON.stringify(state(screen).players.map((p) => p.name)));

  for (const ws of [screen, first, second]) ws.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
