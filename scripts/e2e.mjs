/**
 * Drives a real browser through a real game against the local party server.
 *
 * The suites cover the server and the screens in isolation, and between them
 * they cannot see a layout: jsdom has no boxes to measure. This puts a
 * rendering browser, a live room and a real finger together, and it is how the
 * drawing canvas was found collapsed to nothing on the one screen every player
 * uses — mounted, styled, event handlers attached, and zero pixels tall.
 *
 * Needs three things running:
 *   npm run dev:party
 *   npm run build && npx vite preview --port 4173
 *   Chrome with a debugging port:
 *     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *       --headless=new --remote-debugging-port=9222 \
 *       --user-data-dir=/tmp/jabbloo-e2e about:blank &
 *
 * Then: node scripts/e2e.mjs
 */
// Four letters, like the game makes: the join screen refuses anything else,
// which is correct of it and was rejecting this harness.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
const PARTY = `ws://127.0.0.1:1999/parties/main/${ROOM}`;
const SITE = 'http://127.0.0.1:4173';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const note = (what) => { problems.push(what); console.log('  !! ' + what); };
const ok = (what) => console.log('  ok ' + what);

// --- a socket that plays the part of one device ---------------------------
function device(id) {
  const ws = new WebSocket(`${PARTY}?_pk=${id}`);
  ws.inbox = [];
  ws.addEventListener('message', (e) => ws.inbox.push(JSON.parse(e.data)));
  ws.state = () => [...ws.inbox].reverse()
    .find((m) => m.type === 'state' || m.type === 'welcome')?.state;
  ws.say = (m) => ws.send(JSON.stringify(m));
  return new Promise((res) => ws.addEventListener('open', () => res(ws)));
}

// --- the browser ----------------------------------------------------------
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description
      ?? m.params.exceptionDetails?.text ?? '').split('\n')[0]);
  }
});
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'THREW: ' + r.result.exceptionDetails.text;
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable');
const NAME = 'the phone harness';
/*
 * One harness at a time.
 *
 * Both of these drive the same browser tab, so running them together makes
 * each look like it found a bug in the game — a lobby that never starts, a
 * room code that never appears — when what actually happened is that the other
 * one navigated the page out from under it. Saying so is cheaper than working
 * it out again.
 */
const busy = await evaluate('window.__harness ?? ""');
if (busy) {
  console.log(`  !! another harness (${busy}) is already driving this browser.`);
  console.log('     Run them one at a time, or start a second Chrome on another port.');
  process.exit(1);
}
await evaluate(`window.__harness = ${JSON.stringify(NAME)}`);

// A phone by default; `node scripts/e2e.mjs 1440 800` for a laptop, where the
// toolbar becomes a wrapping column and the layout is a different one.
const VW = Number(process.argv[2] ?? 390);
const VH = Number(process.argv[3] ?? 844);
await send('Emulation.setDeviceMetricsOverride',
  { width: VW, height: VH, deviceScaleFactor: VW < 700 ? 2 : 1, mobile: VW < 700 });

// --- host opens the room, one more player joins by socket -----------------
const host = await device('host');
host.say({ type: 'host', capacity: 2 });
await wait(400);

const bo = await device('bo');
bo.say({ type: 'join', name: 'Bo' });
await wait(400);

// --- the browser joins as a phone -----------------------------------------
// A tab that was in a game goes back to it, which is the point of the resume
// but not what a fresh run wants. Cleared first, then loaded for real.
await send('Page.navigate', { url: SITE });
await wait(900);
await evaluate('try { sessionStorage.clear(); } catch {} "cleared"');
await send('Page.navigate', { url: `${SITE}/?room=${ROOM}` });
await wait(2500);

const joined = await evaluate(`(() => {
  const inputs = [...document.querySelectorAll('input[type=text]')];
  const name = inputs.find((i) => /name/i.test(i.placeholder));
  if (!name) return 'no name field: ' + inputs.map((i) => i.placeholder).join('|');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(name, 'Ann');
  name.dispatchEvent(new Event('input', { bubbles: true }));
  const go = [...document.querySelectorAll('button')].find((b) => /join|go|enter/i.test(b.textContent));
  if (!go) return 'no join button: ' + [...document.querySelectorAll('button')].map((b) => b.textContent).join('|');
  go.click();
  return 'joined';
})()`);
console.log('join:', joined);
await wait(2000);

const inRoom = host.state()?.players.some((p) => p.name === 'Ann');
inRoom ? ok('the browser is in the room') : note('the browser never reached the room');

// --- start, and look at the creation screen the player actually uses ------
host.say({ type: 'start' });
await wait(2500);

const creation = await evaluate(`(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null;
    const b = e.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) }; };
  return JSON.stringify({
    screen: document.querySelector('main')?.className ?? 'none',
    stage: r('.draw-stage'), area: r('.draw-area'), toolbar: r('.toolbar'),
    aim: r('.aim-guide'), zoom: r('.zoom-controls'),
    scrollH: document.documentElement.scrollHeight, inner: innerHeight, innerW: innerWidth,
  });
})()`);
console.log('creation:', creation);

const c = JSON.parse(creation);
if (c.scrollH > c.inner + 1) note(`the creation screen scrolls at ${VW}x${VH}: ${c.scrollH} > ${c.inner}`);
else ok('the creation screen fits the phone');
if (!c.stage) note('no canvas on the creation screen');
else if (c.stage.w < 200) note(`the canvas is tiny: ${c.stage.w}x${c.stage.h}`);
else ok(`canvas ${c.stage.w}x${c.stage.h}`);

if (c.aim && c.zoom) {
  const overlap = !(c.aim.x + 1 > c.zoom.x + c.zoom.w || c.zoom.x > c.aim.x + c.aim.w
    || c.aim.y > c.zoom.y + c.zoom.h || c.zoom.y > c.aim.y + c.aim.h);
  overlap ? note('the aim guide and the zoom buttons overlap') : ok('aim guide clear of the zoom buttons');
}

// --- draw for real, with input the browser generates itself ---------------
//
// Synthetic DOM events are not the same thing: the tool takes pointer capture,
// and a hand-made PointerEvent cannot be captured. This is the actual
// interaction the whole game rests on, so it is worth dispatching properly.
const box = JSON.parse(await evaluate(
  `(() => { const b = document.querySelector('.draw-stage').getBoundingClientRect();
    return JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height }); })()`));

const touch = async (type, x, y) => send('Input.dispatchTouchEvent', {
  type,
  touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + x, y: box.y + y, id: 1 }],
});
await touch('touchStart', 60, 80);
for (let i = 1; i <= 8; i++) await touch('touchMove', 60 + i * 24, 80 + i * 20);
await touch('touchEnd', 0, 0);
await wait(400);

const inked = await evaluate(`(() => {
  const c = document.querySelector('canvas.draw-canvas');
  if (!c) return -1;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let on = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 20) on++;
  return on;
})()`);
inked > 50 ? ok(`a finger leaves a mark (${inked} pixels)`) : note(`drawing left nothing (${inked} pixels)`);

// --- picking a shape must not move anything -------------------------------
//
// Selecting the rectangle or the ellipse reveals one extra control, and one
// extra control is enough to change the height of the toolbar — which comes
// out of the canvas beside it, and looks for all the world like the page
// zooming.
const shapeCheck = await evaluate(`(() => {
  const read = () => {
    const stage = document.querySelector('.draw-stage');
    const b = stage.getBoundingClientRect();
    const tb = document.querySelector('.toolbar').getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height),
      x: Math.round(b.x), y: Math.round(b.y),
      transform: getComputedStyle(stage).transform,
      toolbar: Math.round(tb.height), zoom: visualViewport ? visualViewport.scale : 1 };
  };
  const before = read();
  const pick = (label) => {
    const b = [...document.querySelectorAll('button')].find(
      (x) => (x.getAttribute('aria-label') || x.title || '').toLowerCase() === label);
    if (b) b.click();
    return Boolean(b);
  };
  const found = pick('ellipse') || pick('circle');
  const after = read();
  return JSON.stringify({ found, before, after });
})()`);
const shape = JSON.parse(shapeCheck);
if (!shape.found) note('could not find the ellipse tool to test');
else {
  const moved = ['w', 'h', 'x', 'y'].filter((k) => Math.abs(shape.before[k] - shape.after[k]) > 1);
  moved.length === 0
    ? ok('picking a shape leaves the canvas where it was')
    : note(`picking a shape moved the canvas (${moved.map((k) => k + ' ' + shape.before[k] + '->' + shape.after[k]).join(', ')})`);
  if (shape.before.transform !== shape.after.transform) {
    note(`picking a shape changed the canvas transform (${shape.before.transform} -> ${shape.after.transform})`);
  }
  if (shape.before.toolbar !== shape.after.toolbar) {
    note(`picking a shape changed the toolbar height (${shape.before.toolbar} -> ${shape.after.toolbar})`);
  }
}

// --- through creation, to the vote, to the fight ---------------------------
//
// The screens after this one are where the game actually happens, and they
// were the half of the flow nothing could see. Everything here drives the real
// interface: the browser presses Done and types names the way a player does,
// while the other seat answers over its socket.

/** Scribbles on whatever canvas is on screen, with input the browser makes itself. */
const scribble = async () => {
  const box = await evaluate(`(() => {
    const s = document.querySelector('.draw-stage');
    if (!s) return 'null';
    const b = s.getBoundingClientRect();
    return JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height });
  })()`);
  if (!box || box === 'null') return false;
  const at = JSON.parse(box);
  const touch = (type, x, y) => send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x: at.x + x, y: at.y + y, id: 1 }],
  });
  await touch('touchStart', at.w * 0.25, at.h * 0.3);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', at.w * (0.25 + i * 0.07), at.h * (0.3 + i * 0.06));
  }
  await touch('touchEnd', 0, 0);
  await wait(120);
  return true;
};

/** Answers whatever step the browser is currently showing. */
const answerStep = async () => await evaluate(`(() => {
  const name = document.querySelector('.name-input');
  if (name) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(name, 'Thing ' + Math.floor(Math.random() * 99));
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const save = [...(name.closest('form')?.querySelectorAll('button') ?? [])]
    .find((b) => /save/i.test(b.textContent));
    if (save) { save.click(); return 'named'; }
    return 'name box with no save';
  }
  // Scoped to the drawing tool: the options sheet has a Done of its own, and
  // an unscoped search found that one and clicked it happily for ever.
  const tool = document.querySelector('.screen-draw');
  const done = tool && [...tool.querySelectorAll('button')]
    .find((b) => /^done$/i.test(b.textContent.trim()));
  // Done is deliberately refused on an empty canvas, so an empty one has to be
  // drawn on before it will go anywhere.
  if (done && done.disabled) return 'blank';
  if (done) { done.click(); return 'drew'; }
  return 'waiting';
})()`);

/** The other seat, which has no browser and simply says yes to everything. */
const SLOTS = ['character', 'weapon0', 'weapon1', 'weapon2'];
const answerBo = (state) => {
  const me = state?.players.find((p) => p.id === boId);
  if (!me || me.progress.done) return;
  const slot = SLOTS[Math.floor(me.progress.step / 2)];
  if (!slot) return;
  bo.say(me.progress.step % 2 === 0
    ? { type: 'submitDrawing', slot, png: PNG, done: true }
    : { type: 'submitName', slot, name: `Bo ${slot}` });
};

const boId = bo.state()?.players.find((p) => p.name === 'Bo')?.id
  ?? host.state()?.players.find((p) => p.name === 'Bo')?.id;

for (let i = 0; i < 90; i++) {
  const phase = host.state()?.phase;
  if (phase !== 'creating') break;
  let did = await answerStep();
  if (did === 'blank' && await scribble()) did = await answerStep();
  answerBo(host.state());
  if (process.env['E2E_TRACE'] && i === 1) {
    // Record everything the page sends from here on.
    await evaluate(`(() => {
      if (window.__sent) return 'already';
      window.__sent = [];
      const real = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        try { window.__sent.push(String(data).slice(0, 120)); } catch {}
        return real.call(this, data);
      };
      return 'hooked';
    })()`);
  }
  if (process.env['E2E_TRACE'] && i === 3) {
    console.log('  click probe:', await evaluate(`(() => {
      const tool = document.querySelector('.screen-draw');
      const b = [...tool.querySelectorAll('button')].find((x) => /^done$/i.test(x.textContent.trim()));
      if (!b) return 'no done button in the tool';
      const info = { text: b.textContent.trim(), disabled: b.disabled,
        cls: b.className, visible: b.offsetParent !== null };
      try { b.click(); info.click = 'ok'; }
      catch (e) { info.click = 'THREW ' + e.message; }
      info.after = document.querySelector('.draw-canvas') ? 'still drawing' : 'moved on';
      return JSON.stringify(info);
    })()`));
  }
  if (process.env['E2E_TRACE'] && i === 6) {
    console.log('  sent:', await evaluate(`JSON.stringify((window.__sent || []).slice(-8))`));
    console.log('  all buttons:', await evaluate(`JSON.stringify(
      [...document.querySelectorAll('button')].map((b, i) => i + ':' + (b.textContent.trim() || '?')
        + (b.offsetParent === null ? '(hidden)' : '') + '[' + b.className + ']').slice(0, 40))`));
    console.log('  stuck page:', await evaluate(`JSON.stringify({
      title: document.querySelector('.draw-title')?.textContent,
      hint: document.querySelector('.draw-hint')?.textContent,
      body: (document.querySelector('.creation-body')?.innerText || '').slice(0, 160),
      buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 14),
      canvas: Boolean(document.querySelector('.draw-canvas')),
    })`));
  }
  if (process.env['E2E_TRACE']) {
    const me = host.state()?.players.find((p) => p.name === 'Ann');
    const them = host.state()?.players.find((p) => p.name === 'Bo');
    console.log(`  [${i}] browser:${did} ann:${me?.progress.step}${me?.progress.done ? '/done' : ''}`
      + ` bo:${them?.progress.step}${them?.progress.done ? '/done' : ''}`);
  }
  await wait(220);
}

const reachedVote = host.state()?.phase === 'battleground';
reachedVote ? ok('creation finishes and the vote opens') : note(`stuck in ${host.state()?.phase}`);

if (reachedVote) {
  // The vote is a picture round, so the pictures are the thing to check.
  await wait(1200);
  const vote = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.ground-card')];
    const grid = document.querySelector('.ground-grid');
    return JSON.stringify({
      cards: cards.length,
      hidden: grid ? grid.classList.contains('is-loading') : 'no grid',
      sizes: cards.map((c) => {
        const b = c.getBoundingClientRect();
        const sw = c.querySelector('.ground-swatch');
        const s = sw.getBoundingClientRect();
        const bg = getComputedStyle(sw).backgroundImage;
        return Math.round(b.width) + 'x' + Math.round(b.height)
          + ' img ' + Math.round(s.width) + 'x' + Math.round(s.height)
          + (bg && bg !== 'none' ? ' pic' : ' NO PIC');
      }),
      badge: (() => { const el = document.querySelector('.loading-badge');
        if (!el) return 'gone';
        const b = el.getBoundingClientRect();
        return Math.round(b.width) + 'x' + Math.round(b.height); })(),
      scrollH: document.documentElement.scrollHeight, inner: innerHeight,
    });
  })()`);
  console.log('  vote:', vote);
  const v = JSON.parse(vote);
  if (v.cards !== 4) note(`the vote shows ${v.cards} battlegrounds`);
  else if (v.sizes.some((x) => x.includes('NO PIC'))) note('a battleground has no picture');
  else ok(`battleground cards ${v.sizes[0]}`);
  if (v.hidden === true) note('the grid is still hidden after the photographs loaded');
  if (v.scrollH > v.inner + 1) note(`the vote screen scrolls: ${v.scrollH} > ${v.inner}`);

  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  if (shot2.result?.data) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync('vote.png', Buffer.from(shot2.result.data, 'base64'));
    console.log('  saved vote.png');
  }
}

// --- into the fight -------------------------------------------------------
//
// The arena is where the loading badge shows, where the effects have to
// appear, and where every "it did not animate" report has come from. Nothing
// could see it until now.

if (host.state()?.phase === 'battleground') {
  // Both seats vote, so the draw resolves without waiting out the clock.
  const grounds = host.state()?.players ? ['cliffs', 'forest'] : [];
  await evaluate(`(() => {
    const card = document.querySelector('.ground-card');
    if (card) card.click();
    return 'voted';
  })()`);
  bo.say({ type: 'voteBattleground', id: grounds[1] ?? 'forest' });

  for (let i = 0; i < 60 && host.state()?.phase !== 'battle'; i++) await wait(400);
  const inBattle = host.state()?.phase === 'battle';
  inBattle ? ok('the vote closes and the fight opens') : note(`never reached the fight (${host.state()?.phase})`);

  if (inBattle) {
    // The badge, while the arena is still loading.
    const badge = await evaluate(`(() => {
      const el = document.querySelector('.loading-badge');
      if (!el) return 'gone already';
      const b = el.getBoundingClientRect();
      const letters = [...el.querySelectorAll('img')];
      const first = letters[0]?.getBoundingClientRect();
      return JSON.stringify({
        badge: Math.round(b.width) + 'x' + Math.round(b.height),
        right: Math.round(innerWidth - b.right), bottom: Math.round(innerHeight - b.bottom),
        letters: letters.length,
        letter: first ? Math.round(first.width) + 'x' + Math.round(first.height) : 'none',
        shareOfWidth: Math.round((b.width / innerWidth) * 100) + '%',
      });
    })()`);
    console.log('  badge:', badge);
    if (badge !== 'gone already') {
      const b = JSON.parse(badge);
      const share = Number(b.shareOfWidth.replace('%', ''));
      if (share > 60) note(`the loading badge takes ${b.shareOfWidth} of the screen`);
      else ok(`loading badge ${b.badge} (${b.shareOfWidth} of the width)`);
    }

    /*
     * A phone does not get an arena.
     *
     * The stage belongs to the big screen; a player gets somewhere to write
     * their move and a note telling them where to look. Asserting a canvas
     * here was this harness expecting the host's screen on a phone — see
     * scripts/e2e-host.mjs for the screen that does have one.
     */
    for (let i = 0; i < 40; i++) {
      const up = await evaluate(`Boolean(document.querySelector('.screen-move, .move-input, textarea'))`);
      if (up === true) break;
      await wait(500);
    }
    const phone = await evaluate(`(() => {
      const box = document.querySelector('textarea, .move-input');
      const b = box && box.getBoundingClientRect();
      return JSON.stringify({
        writeBox: b ? Math.round(b.width) + 'x' + Math.round(b.height) : 'none',
        arena: Boolean(document.querySelector('.battle-stage canvas')),
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 70),
        scrollH: document.documentElement.scrollHeight, inner: innerHeight,
      });
    })()`);
    console.log('  phone in the fight:', phone);
    const f = JSON.parse(phone);
    if (f.arena) note('a phone is rendering an arena it does not need');
    else if (f.writeBox === 'none') note('a player has nowhere to write their move');
    else ok(`the move box is ${f.writeBox}`);
    if (f.scrollH > f.inner + 1) note(`the fight screen scrolls on a phone: ${f.scrollH} > ${f.inner}`);

    const shot3 = await send('Page.captureScreenshot', { format: 'png' });
    if (shot3.result?.data) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync('battle.png', Buffer.from(shot3.result.data, 'base64'));
      console.log('  saved battle.png');
    }
  }
}

// A picture of the screen a player actually draws on.
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('creation-phone.png', Buffer.from(shot.result.data, 'base64'));
  console.log('  saved creation-phone.png');
}

console.log('\nconsole output from the page:');
for (const line of [...new Set(logs)].slice(0, 15)) console.log('  ' + line);
if (logs.length === 0) console.log('  (nothing)');

console.log(`\n${problems.length} problem(s)`);
host.close(); bo.close(); await evaluate('window.__harness = ""').catch(() => {});
ws.close();
process.exit(problems.length ? 1 : 0);
