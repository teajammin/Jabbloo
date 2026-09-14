/**
 * Judging and damage tests.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * The rules that decide who wins: a score is damage dealt to the OTHER
 * fighter, judges are averaged, only judges may score a game that has them,
 * and health never goes below zero.
 */
import { GROUND_IDS } from './grounds.mjs';
// A room per scenario. PartyKit keeps a room alive, so sharing one means the
// second setup meets a room that already has a host and every assertion after
// that cascades — which is exactly how this suite first "failed".
let room = '';
const freshRoom = () => { room = 'JDG' + Math.floor(Math.random() * 900000 + 100000); };
const url = () => `ws://127.0.0.1:1999/parties/main/${room}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(url());
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

async function setup(withJudge) {
  freshRoom();
  const host = await open();
  host.send(JSON.stringify({ type: 'host', capacity: withJudge ? 3 : 2 }));
  await wait(200);
  const a = await open(); a.send(JSON.stringify({ type: 'join', name: 'Ann' }));
  const b = await open(); b.send(JSON.stringify({ type: 'join', name: 'Bo' }));
  const j = withJudge ? await open() : null;
  if (j) j.send(JSON.stringify({ type: 'join', name: 'Jud' }));
  await wait(350);

  const ids = state(host).players.filter((p) => !p.isHost).map((p) => p.id);
  host.send(JSON.stringify({ type: 'setRole', playerId: ids[0], role: 'teamA' }));
  host.send(JSON.stringify({ type: 'setRole', playerId: ids[1], role: 'teamB' }));
  if (j) host.send(JSON.stringify({ type: 'setRole', playerId: ids[2], role: 'judge' }));
  await wait(200);
  host.send(JSON.stringify({ type: 'start' }));
  await wait(200);

  for (let i = 0; i < 16; i++) {
    a.send(JSON.stringify({ type: 'ready' }));
    b.send(JSON.stringify({ type: 'ready' }));
    await wait(80);
    if (state(host).phase !== 'creating') break;
  }
  await wait(200);
  a.send(JSON.stringify({ type: 'voteBattleground', id: GROUND_IDS[0] }));
  b.send(JSON.stringify({ type: 'voteBattleground', id: GROUND_IDS[0] }));
  if (j) j.send(JSON.stringify({ type: 'voteBattleground', id: GROUND_IDS[0] }));
  // Wait for the room rather than for a number of milliseconds: the draw is
// held on screen before the battle, and a cold server holds it a moment
// longer than a warm one.
for (let i = 0; i < 90; i++) {
  if (state(host).phase === 'battle') break;
  await wait(120);
}
  return { host, a, b, j, ids };
}

// --- two players: the AI judges through the host ---------------------------
{
  const { host, a, b, ids } = await setup(false);
  check('battle reached', state(host).phase === 'battle', state(host).phase);

  a.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'a mighty slam' }));
  b.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'a gentle poke' }));
  await wait(250);
  host.send(JSON.stringify({ type: 'turnPlayed' }));
  await wait(250);
  check('judging opens', state(host).turn?.phase === 'judging', state(host).turn?.phase);

  // A fighter must not be able to score their own game.
  a.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score: 33 }));
  await wait(150);
  check('a fighter cannot score', Object.keys(state(host).turn?.judged ?? {}).length === 0);

  host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score: 20 }));
  host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[1], score: 10 }));
  await wait(300);

  const s = state(host);
  check('judging closes once both are scored', s.turn?.phase === 'over', s.turn?.phase);
  check('damage is recorded per attacker', s.turn?.damage[ids[0]] === 20, String(s.turn?.damage[ids[0]]));

  const ann = s.players.find((p) => p.id === ids[0]);
  const bo = s.players.find((p) => p.id === ids[1]);
  check('a score damages the OTHER fighter', bo.health === 80, String(bo.health));
  check('and the other way round', ann.health === 90, String(ann.health));

  for (const ws of [host, a, b]) ws.close();
}

// --- with a judge: the host must not override them --------------------------
{
  const { host, a, b, j, ids } = await setup(true);
  a.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'slam' }));
  b.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'poke' }));
  await wait(250);
  host.send(JSON.stringify({ type: 'turnPlayed' }));
  await wait(250);

  host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score: 33 }));
  await wait(150);
  check('the host cannot score a judged game',
    Object.keys(state(host).turn?.judged ?? {}).length === 0);

  j.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score: 30 }));
  await wait(150);
  check('one fighter scored, still open', state(host).turn?.phase === 'judging');

  j.send(JSON.stringify({ type: 'submitScore', attackerId: ids[1], score: 4 }));
  await wait(300);
  const s = state(host);
  check('the judge closes it', s.turn?.phase === 'over', s.turn?.phase);
  check('the judge decides the damage', s.turn?.damage[ids[0]] === 30, String(s.turn?.damage[ids[0]]));

  for (const ws of [host, a, b, j]) ws.close();
}

// --- stats accumulate across the fight -------------------------------------
{
  const { host, a, b, ids } = await setup(false);
  const prompts = [['a mighty slam', 'a poke'], ['a huge kick', 'a nudge'], ['the big one', 'a tap']];
  const scores = [[20, 5], [10, 5], [25, 5]];

  for (let round = 0; round < 3; round++) {
    a.send(JSON.stringify({ type: 'submitMove', weapon: 1, prompt: prompts[round][0] }));
    b.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: prompts[round][1] }));
    await wait(200);
    host.send(JSON.stringify({ type: 'turnPlayed' }));
    await wait(180);
    host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score: scores[round][0] }));
    host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[1], score: scores[round][1] }));
    await wait(220);
    host.send(JSON.stringify({ type: 'turnDone' }));
    await wait(200);
  }

  const s = state(host);
  const ann = s.players.find((p) => p.id === ids[0]);
  const bo = s.players.find((p) => p.id === ids[1]);

  /*
   * Scores were 20, 10 and 25, and the last round counts double: 20 + 10 + 50.
   * The totals are what the results screen shows, so they include the
   * multiplier rather than the raw scores — a player told they dealt 55 after
   * seeing 50 land in one hit would rightly think the game was lying.
   */
  check('damage given adds up, with the last round doubled',
    ann.damageDealt === 80, String(ann.damageDealt));
  check('damage taken adds up the same way', ann.damageTaken === 20, String(ann.damageTaken));
  check('the other side mirrors it', bo.damageTaken === 80, String(bo.damageTaken));
  check('the best hit is the hardest one, as it landed',
    ann.best?.damage === 50, JSON.stringify(ann.best));
  check('the best hit quotes what was written',
    ann.best?.prompt === 'the big one', ann.best?.prompt);
  check('health never goes below zero', s.players.every((p) => p.health >= 0),
    JSON.stringify(s.players.map((p) => p.health)));
  check('the fight ends in results', s.phase === 'results', s.phase);

  // Rematch returns to the vote with the same characters.
  host.send(JSON.stringify({ type: 'rematch' }));
  await wait(250);
  check('rematch reopens the vote', state(host).phase === 'battleground', state(host).phase);
  check('names survive a rematch',
    state(host).players.find((p) => p.id === ids[0])?.weaponNames !== undefined);

  for (const ws of [host, a, b]) ws.close();
}

// --- judges can still score after the first round ---------------------------
//
// Turns used to be identified by which two fighters were in them, which is the
// same every round of a 1v1 — so the judges' panel decided it had already been
// built and left everyone holding a spent one from round two onwards.
{
  const { host, a, b, j, ids } = await setup(true);

  const rounds = [];
  for (let round = 0; round < 3; round++) {
    a.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: `swing ${round}` }));
    b.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: `poke ${round}` }));
    await wait(220);
    host.send(JSON.stringify({ type: 'turnPlayed' }));
    await wait(200);

    const turn = state(host).turn;
    rounds.push(turn?.index);
    check(`round ${round + 1} is judged`, turn?.phase === 'judging', turn?.phase);

    j.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score: 10 + round }));
    j.send(JSON.stringify({ type: 'submitScore', attackerId: ids[1], score: 5 }));
    await wait(260);
    // The third round is each fighter's last, and is worth double.
    const expected = round === 2 ? (10 + round) * 2 : 10 + round;
    check(`round ${round + 1} accepts the judge's score`,
      (state(host).turn?.damage?.[ids[0]] ?? 0) === expected,
      JSON.stringify(state(host).turn?.damage));

    host.send(JSON.stringify({ type: 'turnDone' }));
    await wait(240);
  }

  check('every turn has an identity of its own',
    new Set(rounds).size === rounds.length, JSON.stringify(rounds));
  check('and they count upward', rounds.every((n, i) => i === 0 || n > rounds[i - 1]),
    JSON.stringify(rounds));

  for (const ws of [host, a, b, j]) ws.close();
}

// --- the last round counts double ------------------------------------------
//
// Three rounds that all count the same make the last one a formality: whoever
// leads after two usually leads after three. Doubling the last one means a
// fight is never over until it is over.
{
  const { host, a, b, ids } = await setup(false);
  const damages = [];

  for (let round = 0; round < 3; round++) {
    a.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'the same swing' }));
    b.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'the same swing' }));
    await wait(220);
    host.send(JSON.stringify({ type: 'turnPlayed' }));
    await wait(200);
    // The same score every round, so any difference in damage is the rule and
    // not the judge changing its mind.
    host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[0], score: 10 }));
    host.send(JSON.stringify({ type: 'submitScore', attackerId: ids[1], score: 10 }));
    await wait(280);
    damages.push(state(host).turn?.damage?.[ids[0]]);
    host.send(JSON.stringify({ type: 'turnDone' }));
    await wait(260);
  }

  check('the first two rounds score as given',
    damages[0] === 10 && damages[1] === 10, JSON.stringify(damages));
  check('the last one counts double', damages[2] === 20, JSON.stringify(damages));
  check('and the totals include it',
    state(host).players.find((p) => p.id === ids[0])?.damageDealt === 40,
    String(state(host).players.find((p) => p.id === ids[0])?.damageDealt));

  for (const ws of [host, a, b]) ws.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
