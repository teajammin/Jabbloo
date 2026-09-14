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
host.close(); bo.close(); ws.close();
process.exit(problems.length ? 1 : 0);
