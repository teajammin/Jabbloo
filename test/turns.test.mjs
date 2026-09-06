/**
 * Turn loop tests.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * The rules worth pinning down are the ones that would quietly unbalance the
 * game: who strikes first is drawn only once both moves are in, a player who
 * writes nothing still fights, prompts are trimmed to the brief's limit, and
 * nobody fights a fourth time.
 */
const ROOM = 'TRN' + Math.floor(Math.random() * 9000 + 1000);
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
await wait(200);

// Race through creation, naming as we go so the names reach every screen.
const steps = [
  ['submitDrawing', 'character'], ['submitName', 'character'],
  ['submitDrawing', 'weapon0'], ['submitName', 'weapon0'],
  ['submitDrawing', 'weapon1'], ['submitName', 'weapon1'],
  ['submitDrawing', 'weapon2'], ['submitName', 'weapon2'],
];
for (const [type, slot] of steps) {
  for (const [ws, who] of [[a, 'Ann'], [b, 'Bo']]) {
    ws.send(JSON.stringify(type === 'submitDrawing'
      ? { type, slot, png: PNG }
      : { type, slot, name: `${who} ${slot}` }));
  }
  await wait(80);
}
await wait(250);

check('names reach every screen',
  state(a).players.find((p) => p.id === ids[0])?.weaponNames.length === 3,
  JSON.stringify(state(a).players.find((p) => p.id === ids[0])?.weaponNames));

// Vote, then wait out the reveal into the battle.
a.send(JSON.stringify({ type: 'voteBattleground', id: 'sky' }));
b.send(JSON.stringify({ type: 'voteBattleground', id: 'sky' }));
await wait(4600);

let s = state(host);
check('the battle starts', s.phase === 'battle', s.phase);
check('a turn is set up', Boolean(s.turn), JSON.stringify(s.turn));
check('one fighter from each side', s.turn?.fighters.length === 2);
check('everyone starts on full health', s.players.every((p) => p.isHost || p.health === 100));
check('nobody has fought yet', s.players.every((p) => p.fights === 0));
check('moves are being collected', s.turn?.phase === 'picking', s.turn?.phase);

// Submitting first must not decide who strikes first.
a.send(JSON.stringify({ type: 'submitMove', weapon: 1, prompt: 'spin it overhead' }));
await wait(180);
check('one move in, still collecting', state(host).turn?.phase === 'picking');
check('first strike is not decided yet', state(host).turn?.first === null);

// An over-long prompt is trimmed rather than refused.
const longPrompt = Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ');
b.send(JSON.stringify({ type: 'submitMove', weapon: 9, prompt: longPrompt }));
await wait(250);
s = state(host);
check('both in, moves lock', s.turn?.phase === 'playing', s.turn?.phase);
check('a first striker is drawn', s.turn?.fighters.includes(s.turn?.first), String(s.turn?.first));
check('the prompt is trimmed to 50 words',
  s.turn?.moves[ids[1]]?.prompt.split(' ').length === 50,
  String(s.turn?.moves[ids[1]]?.prompt.split(' ').length));
check('an out-of-range weapon is clamped',
  s.turn?.moves[ids[1]]?.weapon === 2, String(s.turn?.moves[ids[1]]?.weapon));

// The host drives the loop on.
host.send(JSON.stringify({ type: 'turnDone' }));
await wait(250);
s = state(host);
check('both fighters count a round', s.players.filter((p) => p.fights === 1).length === 2);
check('a fresh turn begins', s.turn?.phase === 'picking');

// Two more rounds and the battle should be over, not a fourth.
for (let i = 0; i < 2; i++) {
  a.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'bonk' }));
  b.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'bonk' }));
  await wait(180);
  host.send(JSON.stringify({ type: 'turnDone' }));
  await wait(180);
}
s = state(host);
check('nobody fights a fourth time', s.players.every((p) => p.isHost || p.fights <= 3),
  JSON.stringify(s.players.map((p) => p.fights)));
check('the battle ends after three rounds', s.phase === 'results', s.phase);

for (const ws of [host, a, b]) ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
