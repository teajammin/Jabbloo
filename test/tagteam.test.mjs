/**
 * Tag team tests: four and six players.
 *
 * Needs a live party: `npm run dev:party`.
 *
 * The brief's rule is that every character fights three rounds and who they
 * meet is drawn each time. With more than one fighter a side, that means the
 * room has to keep picking pairs until everyone has had their three — and the
 * pairings should not settle into the same two people every round.
 */
import { GROUND_IDS } from './grounds.mjs';
import { makeEverything } from './creation-helper.mjs';

let room = '';
const freshRoom = () => { room = 'TAG' + Math.floor(Math.random() * 900000 + 100000); };
const url = (id) => `ws://127.0.0.1:1999/parties/main/${room}?_pk=${id}`;
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

/** A room of `count` fighters, split evenly, played to the end of the battle. */
async function playOut(count, { score = 4 } = {}) {
  freshRoom();
  const host = await open('host');
  host.send(JSON.stringify({ type: 'host', capacity: count }));
  await wait(300);

  const players = [];
  for (let i = 0; i < count; i++) {
    const ws = await open(`p${i}`);
    ws.send(JSON.stringify({ type: 'join', name: `P${i}` }));
    players.push(ws);
  }
  await wait(500);

  const ids = state(host).players.filter((p) => !p.isHost).map((p) => p.id);
  ids.forEach((id, i) => host.send(JSON.stringify({
    type: 'setRole', playerId: id, role: i < count / 2 ? 'teamA' : 'teamB',
  })));
  await wait(300);
  host.send(JSON.stringify({ type: 'start' }));
  await wait(300);

  // Everyone makes everything, each answered on the step they are actually on:
  // players walk their own path through creation now, so one can be naming a
  // second weapon while another is still drawing a character.
  const byId = Object.fromEntries(ids.map((id, i) => [id, players[i]]));
  await makeEverything(host, byId, state, wait);
  await wait(250);

  for (const ws of players) {
    ws.send(JSON.stringify({ type: 'voteBattleground', id: GROUND_IDS[0] }));
  }
  // The draw is held on screen before the battle; wait for the room rather
  // than for a number of milliseconds.
  for (let i = 0; i < 90; i++) {
    if (state(host).phase === 'battle') break;
    await wait(120);
  }

  // Fight until the room says it is over, recording who met whom.
  const pairings = [];
  for (let turn = 0; turn < 40; turn++) {
    const now = state(host);
    if (now.phase !== 'battle' || !now.turn) break;

    const [a, b] = now.turn.fighters;
    pairings.push([a, b].sort().join(' vs '));

    byId[a]?.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'a swing' }));
    byId[b]?.send(JSON.stringify({ type: 'submitMove', weapon: 0, prompt: 'a poke' }));
    await wait(220);
    host.send(JSON.stringify({ type: 'turnPlayed' }));
    await wait(200);
    // Modest, equal damage: nobody is knocked out, so every fighter can take
    // all three of their turns and the counting means something.
    host.send(JSON.stringify({ type: 'submitScore', attackerId: a, score }));
    host.send(JSON.stringify({ type: 'submitScore', attackerId: b, score }));
    await wait(250);
    host.send(JSON.stringify({ type: 'turnDone' }));
    await wait(250);
  }

  const final = state(host);
  for (const ws of [host, ...players]) ws.close();
  return { final, ids, pairings };
}

// --- four players: two a side ----------------------------------------------
{
  const { final, ids, pairings } = await playOut(4);
  const fighters = final.players.filter((p) => !p.isHost);

  check('four players: the battle finished', final.phase !== 'battle', final.phase);
  check('everyone fought three times',
    fighters.every((p) => p.fights === 3),
    JSON.stringify(fighters.map((p) => [p.name, p.fights])));
  check('which is six turns in all', pairings.length === 6, String(pairings.length));
  check('every turn was one from each side',
    pairings.every((pair) => {
      const [x, y] = pair.split(' vs ');
      const side = (id) => fighters.find((p) => p.id === id)?.role;
      return side(x) !== side(y);
    }), JSON.stringify(pairings.length));
  check('and nobody fought a fourth time',
    fighters.every((p) => p.fights <= 3));
  check('more than one pairing came up',
    new Set(pairings).size > 1, JSON.stringify([...new Set(pairings)]));
}

// --- six players: three a side ---------------------------------------------
{
  const { final, pairings } = await playOut(6, { score: 2 });
  const fighters = final.players.filter((p) => !p.isHost);

  check('six players: the battle finished', final.phase !== 'battle', final.phase);
  check('everyone fought three times',
    fighters.every((p) => p.fights === 3),
    JSON.stringify(fighters.map((p) => [p.name, p.fights])));
  check('which is nine turns in all', pairings.length === 9, String(pairings.length));
  check('the pairings were mixed, not the same two all night',
    new Set(pairings).size >= 3, JSON.stringify([...new Set(pairings)]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
