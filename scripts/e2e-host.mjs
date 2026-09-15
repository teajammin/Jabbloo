/**
 * Drives the host's big screen through a whole fight.
 *
 * The other harness plays a phone, which never sees the arena: the battle
 * screen belongs to the laptop, and so do the loading badge, the choreography
 * and every effect sprite. Every "it did not animate" report is about this
 * screen, and nothing could look at it.
 *
 * The browser creates the room and presses Start; two sockets play the
 * players. Needs the same three things running as scripts/e2e.mjs, with Chrome
 * started so WebGL works — the arena will not render without it:
 *
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --no-sandbox --use-gl=angle --use-angle=swiftshader \
 *     --enable-unsafe-swiftshader --remote-debugging-port=9222 \
 *     --user-data-dir=/tmp/jabbloo-e2e about:blank &
 *
 *   node scripts/e2e-host.mjs [width] [height] ["a move to test"]
 */
/*
 * Where to play.
 *
 * Local by default. The local party server deliberately has no Anthropic key —
 * keys live in .env.local, which PartyKit does not read — so every move there
 * falls back to the stock swing, which has no effects in it at all. Checking
 * whether a gun fires therefore has to be done against the deployed server:
 *
 *   E2E_LIVE=1 node scripts/e2e-host.mjs
 *
 * That spends a few tenths of a cent on two real choreographies.
 */
const LIVE = process.env['E2E_LIVE'] === '1';
const SITE = LIVE ? 'https://jabbloo.teajammin.partykit.dev' : 'http://127.0.0.1:4173';
const PARTY_HOST = LIVE ? 'jabbloo.teajammin.partykit.dev' : '127.0.0.1:1999';
const WS = LIVE ? 'wss' : 'ws';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const VW = Number(process.argv[2] ?? 1440);
const VH = Number(process.argv[3] ?? 800);
const MOVE = process.argv[4] ?? 'shoot them with my gun';

const SLOW = process.env['E2E_LIVE'] === '1' ? 2.2 : 1;
const wait = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));
const problems = [];
const note = (what) => { problems.push(what); console.log('  !! ' + what); };
const ok = (what) => console.log('  ok ' + what);

// --- the browser ----------------------------------------------------------
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 180));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails?.exception?.description
      ?? m.params.exceptionDetails?.text ?? '';
    logs.push('EXCEPTION: ' + (process.env['E2E_STACK'] ? d.split('\n').slice(0, 8).join('\n    ') : d.split('\n')[0]));
  }
});
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    return 'THREW: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  }
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',
  { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
// A tab that was in a game goes back to it, which is the point of the resume
// but not what a fresh run wants. Cleared first, then loaded for real.
await send('Page.navigate', { url: SITE });
await wait(900);
await evaluate('try { sessionStorage.clear(); } catch {} "cleared"');
await send('Page.navigate', { url: SITE + '/?debug' });
await wait(2500);

// --- open a room on the big screen ---------------------------------------
await evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /create room/i.test(x.textContent));
  if (b) b.click();
})()`);
await wait(900);
await evaluate(`(() => {
  const open = [...document.querySelectorAll('button')].find((x) => /open the room/i.test(x.textContent));
  if (open) open.click();
})()`);
await wait(1800);

const code = await evaluate(
  `document.querySelector('.screen-lobby [role="img"]')?.getAttribute('aria-label') ?? ''`);
code && code.length === 4 ? ok(`the room opens as ${code}`) : note(`no room code (${code})`);

// --- two players join over sockets ---------------------------------------
const device = (id) => new Promise((res) => {
  const s = new WebSocket(`${WS}://${PARTY_HOST}/parties/main/${code}?_pk=${id}`);
  s.inbox = [];
  s.addEventListener('message', (e) => s.inbox.push(JSON.parse(e.data)));
  s.state = () => [...s.inbox].reverse().find((m) => m.type === 'state' || m.type === 'welcome')?.state;
  s.say = (m) => s.send(JSON.stringify(m));
  s.addEventListener('open', () => res(s));
});

const ann = await device('ann');
ann.say({ type: 'join', name: 'Ann' });
const bo = await device('bo');
bo.say({ type: 'join', name: 'Bo' });
await wait(900);

const ids = Object.fromEntries((ann.state()?.players ?? [])
  .filter((p) => !p.isHost).map((p) => [p.name, p.id]));
Object.keys(ids).length === 2 ? ok('both players are in') : note('players missing: ' + JSON.stringify(ids));

// --- the host presses Start ----------------------------------------------
// Start stays disabled until the room is ready, and how long that takes is
// not this script's business to predict.
let started = false;
for (let i = 0; i < 20 && !started; i++) {
  const r = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^start$/i.test(x.textContent.trim()));
    if (!b) return 'no start button';
    if (b.disabled) return 'disabled';
    b.click();
    return 'started';
  })()`);
  if (r === 'started') started = true;
  else await wait(700);
}
started ? ok('the host starts the game') : note('Start never became available');
await wait(1200);

// --- both players make everything ----------------------------------------
const SLOTS = ['character', 'weapon0', 'weapon1', 'weapon2'];
for (let i = 0; i < 90; i++) {
  const state = ann.state();
  if (!state || state.phase !== 'creating') break;
  for (const [name, seat] of [['Ann', ann], ['Bo', bo]]) {
    const me = state.players.find((p) => p.id === ids[name]);
    if (!me || me.progress.done) continue;
    const slot = SLOTS[Math.floor(me.progress.step / 2)];
    if (!slot) continue;
    seat.say(me.progress.step % 2 === 0
      ? { type: 'submitDrawing', slot, png: PNG, done: true }
      : { type: 'submitName', slot, name: `${name}'s ${slot}` });
  }
  await wait(180);
}
console.log('  phase after creation loop:', ann.state()?.phase);
ann.state()?.phase === 'battleground' ? ok('creation finishes') : note(`stuck in ${ann.state()?.phase}`);

// --- vote, and into the arena --------------------------------------------
ann.say({ type: 'voteBattleground', id: 'forest' });
bo.say({ type: 'voteBattleground', id: 'forest' });
for (let i = 0; i < 60 && ann.state()?.phase !== 'battle'; i++) await wait(400);
const inBattle = ann.state()?.phase === 'battle';
inBattle ? ok('the fight opens') : note(`never reached the fight (${ann.state()?.phase})`);

if (inBattle) {
  // Watch what the choreographer actually hands back. A request that fails
  // falls back to a stock swing, which has no effects in it at all — so a
  // silent fallback and a broken renderer look identical from the outside.
  await evaluate(`(() => {
    if (window.__api) return 'already';
    window.__api = [];
    const real = window.fetch;
    window.fetch = async function (input, init) {
      const url = String(typeof input === 'string' ? input : input.url);
      const res = await real.call(this, input, init);
      if (url.includes('/api/')) {
        try {
          const copy = res.clone();
          const text = await copy.text();
          let sent = '';
          try { sent = typeof init?.body === 'string' ? init.body : ''; } catch {}
          const asked = sent ? JSON.parse(sent) : {};
          window.__api.push({ url, status: res.status,
            sentRoom: asked.room, sentDevice: asked.device,
            body: text.slice(0, 200) });
        } catch (e) { window.__api.push({ url, status: res.status, body: 'unreadable: ' + e.message }); }
      }
      return res;
    };
    return 'hooked';
  })()`);

  // The badge is up while the renderer, the sprites and the artwork load.
  const badge = await evaluate(`(() => {
    const el = document.querySelector('.loading-badge');
    if (!el) return 'gone already';
    const b = el.getBoundingClientRect();
    const first = el.querySelector('img')?.getBoundingClientRect();
    return JSON.stringify({
      size: Math.round(b.width) + 'x' + Math.round(b.height),
      letters: el.querySelectorAll('img').length,
      letter: first ? Math.round(first.width) + 'x' + Math.round(first.height) : 'none',
      share: Math.round((b.width / innerWidth) * 100) + '%',
    });
  })()`);
  console.log('  badge:', badge);

  for (let i = 0; i < 60; i++) {
    if (await evaluate(`Boolean(document.querySelector('.battle-stage canvas'))`) === true) break;
    await wait(500);
  }
  const arena = await evaluate(`(() => {
    const c = document.querySelector('.battle-stage canvas');
    if (!c) return 'no canvas';
    const b = c.getBoundingClientRect();
    return JSON.stringify({ canvas: Math.round(b.width) + 'x' + Math.round(b.height),
      scrollH: document.documentElement.scrollHeight, inner: innerHeight });
  })()`);
  console.log('  arena:', arena);
  arena === 'no canvas' ? note('the arena never rendered') : ok('the arena renders');

  // --- the move everything else exists for -------------------------------
  for (let i = 0; i < 40; i++) {
    if (ann.state()?.turn?.phase === 'picking') break;
    await wait(500);
  }
  const turn = ann.state()?.turn;
  if (turn?.phase === 'picking') {
    ann.say({ type: 'submitMove', weapon: 0, prompt: MOVE });
    bo.say({ type: 'submitMove', weapon: 0, prompt: 'swing wildly at their head' });
    console.log(`  Ann is ${ids['Ann']}, Bo is ${ids['Bo']}`);
    ok(`moves sent ("${MOVE}")`);

    // One seat goes dark, which is the state the host screen has been
    // complaining about: a player replaced by a bot mid-fight.
    if (process.env['E2E_DROP'] === '1') {
      bo.close();
      console.log('  dropped Bo');
    }

    // The entrance comes first — names, VERSUS, FIGHT — and takes the better
    // part of ten seconds. Watching from here would spend the whole window on
    // people walking on, which is how an earlier run concluded that nothing
    // ever happened.
    let phase = '';
    for (let i = 0; i < 80; i++) {
      phase = ann.state()?.turn?.phase ?? 'none';
      if (phase === 'playing' || phase === 'judging') break;
      await wait(500);
    }
    console.log('  turn phase before watching:', phase);
    // Ask the room the same question the worker asks it, with the same id the
    // page would send, and print both halves.
    const who = await evaluate(`(() => {
      const w = window.__battle;
      return JSON.stringify({ search: location.search, hasHook: Boolean(w) });
    })()`);
    console.log('  page:', who);
    const state = ann.state();
    const hostSeat = state?.players.find((p) => p.isHost);
    console.log('  host seat:', JSON.stringify({ id: hostSeat?.id, connected: hostSeat?.connected }));
    console.log('  turn:', JSON.stringify({ phase: state?.phase, turnPhase: state?.turn?.phase }));
    try {
      const vouch = await fetch(
        `${SITE}/parties/main/${code}?device=${encodeURIComponent(hostSeat?.id ?? '')}`);
      console.log('  room vouch says:', vouch.status, (await vouch.text()).slice(0, 120));
    } catch (e) { console.log('  room vouch failed:', e.message); }

    console.log('  battle sees:', await evaluate(`(() => {
      const b = window.__battle;
      if (!b) return 'no debug hook';
      return JSON.stringify({ onStage: b.onStage(), art: b.art(),
        fighters: b.turn()?.fighters, moves: Object.keys(b.turn()?.moves ?? {}) });
    })()`));

    // Watch the effects layer while the choreography plays. This is the thing
    // every "nothing came out of the gun" report is actually about.
    const seen = await evaluate(`(async () => {
      const found = new Set();
      let frames = 0;
      for (let i = 0; i < 70; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const s = window.__stage;
        if (!s) continue;
        frames++;
        for (const child of s.effects.children) {
          const t = child.texture;
          const url = t && t.baseTexture && t.baseTexture.resource
            ? String(t.baseTexture.resource.url ?? t.baseTexture.resource.src ?? '?') : '?';
          found.add(url.split('/').pop() + ' ' + Math.round(child.width) + 'x' + Math.round(child.height));
        }
      }
      return JSON.stringify({ frames, effects: [...found] });
    })()`);
    console.log('  effects seen:', seen);

    /*
     * Who the lingering harm actually happened to.
     *
     * Only Ann's move can poison anybody — Bo swings — so if this works, Bo is
     * the one who changes colour and Ann never does. It was the other way
     * round twice, which is why it is worth watching rather than reasoning
     * about: the tint lives in a WebGL scene where nothing outside can see it.
     */
    if (/poison|rot|venom|sick|burn|curse/i.test(MOVE)) {
      const tinted = await evaluate(`(async () => {
        const seenTints = {};
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 250));
          const b = window.__battle;
          if (!b || !b.tints) continue;
          for (const [id, tint] of Object.entries(b.tints())) {
            if (tint !== 0xffffff) seenTints[id] = '0x' + Number(tint).toString(16);
          }
        }
        return JSON.stringify(seenTints);
      })()`);
      console.log('  who changed colour:', tinted);
      const who = typeof tinted === 'string' && tinted.startsWith('{') ? JSON.parse(tinted) : null;
      if (!who) note('could not watch the fighters for lingering harm');
      else if (who[ids['Ann']]) note('the poison landed on the fighter who cast it');
      else if (who[ids['Bo']]) ok('the poison landed on the opponent');
      else note('nobody was poisoned by a move that said poison');
    }
    const e = typeof seen === 'string' && seen.startsWith('{') ? JSON.parse(seen) : null;
    if (!e) note('could not watch the effects layer');
    else if (e.frames === 0) note('the stage was never reachable to watch');
    else if (e.effects.length === 0) note('no effect sprite appeared during the whole exchange');
    else ok(`effects on screen: ${e.effects.join(', ')}`);
  } else {
    note(`the turn never opened for moves (${turn?.phase})`);
  }

  const banner = await evaluate(
    `document.querySelector('.breakage')?.textContent ?? 'none'`);
  banner === 'none' ? ok('no breakage banner') : note(`breakage banner: ${banner}`);

  console.log('  api calls:', await evaluate(`JSON.stringify(window.__api ?? [], null, 1).slice(0, 1200)`));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync('battle-host.png', Buffer.from(shot.result.data, 'base64'));
    console.log('  saved battle-host.png');
  }
}

console.log('\nconsole output from the page:');
for (const line of [...new Set(logs)].slice(0, 12)) console.log('  ' + line);
if (logs.length === 0) console.log('  (nothing)');
console.log(`\n${problems.length} problem(s)`);
for (const s of [ann, bo]) s.close();
ws.close();
process.exit(problems.length ? 1 : 0);
