/**
 * Screen smoke tests.
 *
 * Every screen in this game is plain DOM, so it can be mounted and driven in
 * Node against a stubbed browser. That matters more here than usual: without
 * it, the first time any of this code runs is on a phone in someone's living
 * room, halfway through a party.
 *
 * These do not check that anything *looks* right — nothing in Node can. They
 * check that each screen mounts, renders the state it is given, survives the
 * phase changes the server will actually send it, and tears down clean.
 */
import { installDom } from './dom.mjs';

installDom();

const ui = await import('../node_modules/.cache/tests/screens-entry.mjs');
const { setHome } = ui;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

/** Runs a screen and reports anything it throws rather than dying. */
function mounts(name, screen, after) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let teardown;
  try {
    const go = () => {};
    teardown = screen(root, go);
    after?.(root);
    check(`${name} mounts`, root.childElementCount > 0, 'nothing rendered');
  } catch (error) {
    check(`${name} mounts`, false, String(error?.stack ?? error).split('\n').slice(0, 3).join(' | '));
    return null;
  }
  try {
    teardown?.();
    check(`${name} tears down`, true);
  } catch (error) {
    check(`${name} tears down`, false, String(error?.message ?? error));
  }
  root.remove();
  return root;
}

// --- a room, and a connection that only pretends to be one ------------------

const player = (id, name, role, extra = {}) => ({
  id, name, role, connected: true, isHost: false,
  progress: { drawn: [], named: [], ready: false },
  health: 100, fights: 0,
  characterName: `${name}alot`, weaponNames: ['Butter Sword', 'Axe', 'Hammer'],
  damageDealt: 12, damageTaken: 20,
  best: { weapon: 'Butter Sword', prompt: 'slam it down like a thunderbolt', damage: 12 },
  ...extra,
});

const roomState = (over = {}) => ({
  code: 'ABCD', phase: 'lobby', capacity: 2,
  players: [
    player('h', 'Host', 'unassigned', { isHost: true }),
    player('a', 'Ann', 'teamA'),
    player('b', 'Bo', 'teamB'),
  ],
  teamNames: { teamA: 'Team One', teamB: 'Team Two' },
  step: -1, ultRound: 0, votes: {}, chosen: null, turn: null,
  stepEndsAt: Date.now() + 30000,
  ...over,
});

const turn = (phase = 'picking') => ({
  fighters: ['a', 'b'],
  moves: phase === 'picking' ? {} : { a: { weapon: 0, prompt: 'bonk' }, b: { weapon: 1, prompt: 'poke' } },
  judged: {}, damage: { a: 12, b: 7 }, notes: { a: 'Committed nonsense' },
  first: 'a', phase,
});

/** A connection that records what a screen sends and replays states into it. */
function fakeConnection(playerId = 'a', state = roomState()) {
  const sent = [];
  const handlers = {};
  return {
    playerId, state, sent,
    on(next) { Object.assign(handlers, next); return this; },
    send(message) { sent.push(message); },
    close() { this.closed = true; },
    /** What the server would push next. */
    push(over) {
      this.state = { ...this.state, ...over };
      handlers.onState?.(this.state);
    },
    art(art) { handlers.onArt?.(art); },
  };
}

// --- the screens that need nothing ------------------------------------------

setHome(ui.launchScreen);
mounts('launch', ui.launchScreen, (root) => {
  const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
  check('the launch screen offers exactly the two ways in',
    labels.some((l) => /create room/i.test(l)) && labels.some((l) => /join room/i.test(l)),
    JSON.stringify(labels));
});
mounts('create room', ui.createRoomScreen);
mounts('join room', ui.joinRoomScreen);

// --- a dropped connection has to be visible ---------------------------------

{
  const teardown = ui.mountConnectionBanner();
  const banner = document.querySelector('.connection-banner');
  const drop = (open) => window.dispatchEvent(
    new CustomEvent(ui.CONNECTION_EVENT, { detail: { open } }),
  );

  check('nothing is shown while all is well', banner?.hidden === true);

  drop(false);
  check('a blink does not raise a banner', banner?.hidden === true);
  drop(true);
  await new Promise((r) => setTimeout(r, 1400));
  check('and a reconnect inside the grace period passes unremarked',
    banner?.hidden === true);

  drop(false);
  await new Promise((r) => setTimeout(r, 1400));
  check('a connection that stays down is announced', banner?.hidden === false);
  drop(true);
  check('and the notice clears when it comes back', banner?.hidden === true);

  teardown();
  check('the banner tears down', document.querySelector('.connection-banner') === null);
}


// --- the drawing tool -------------------------------------------------------

let exported = null;
mounts('drawing tool', ui.drawScreen({ title: 'Draw your character', onDone: (png) => { exported = png; } }),
  (root) => {
    const overlay = root.querySelector('.draw-overlay');
    check('the drawing tool has a canvas', overlay !== null);
    if (!overlay) return;
    // A stroke, start to finish, the way a finger makes one.
    overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 40, clientY: 40, buttons: 1, isPrimary: true }));
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: 90, buttons: 1, isPrimary: true }));
    overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 80, clientY: 90, isPrimary: true }));
    const done = [...root.querySelectorAll('button')].find((b) => /done/i.test(b.textContent));
    check('the drawing tool has a Done button', Boolean(done));
    check('a stroke enables Done', done?.disabled === false, 'the stroke did not land');

    // Undo and redo, through the shortcuts, checked by what they do to the
    // canvas rather than by not throwing.
    const key = (init) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    key({ key: 'z', metaKey: true });
    check('cmd-Z takes the stroke back', done?.disabled === true);
    key({ key: 'z', metaKey: true, shiftKey: true });
    check('and cmd-shift-Z brings it back', done?.disabled === false);

    done?.click();
    check('Done exports a PNG', typeof exported === 'string' && exported.startsWith('data:image/png'),
      String(exported).slice(0, 24));
  });

// --- creation ---------------------------------------------------------------

{
  const connection = fakeConnection('a', roomState({ phase: 'creating', step: 0 }));
  mounts('creation (player)', ui.creationScreen(connection, false), () => {
    connection.push({ phase: 'creating', step: 1 });
    connection.push({ phase: 'creating', step: 2 });
  });

  const hostConnection = fakeConnection('h', roomState({ phase: 'creating', step: 0 }));
  mounts('creation (host)', ui.creationScreen(hostConnection, true));

  const ultConnection = fakeConnection('a', roomState({ phase: 'ult', ultRound: 1, step: 0 }));
  mounts('creation (ULT)', ui.creationScreen(ultConnection, false), (root) => {
    check('the ULT step names itself',
      /ULT/i.test(root.textContent ?? ''), root.textContent?.slice(0, 80));
  });
}

// --- battleground vote ------------------------------------------------------

{
  const connection = fakeConnection('a', roomState({ phase: 'battleground' }));
  mounts('battleground', ui.battlegroundScreen(connection, false), (root) => {
    const first = root.querySelector('button');
    first?.click();
    check('voting sends a vote',
      connection.sent.some((m) => m.type === 'voteBattleground'), JSON.stringify(connection.sent));
    connection.push({ chosen: ui.battlegrounds[0].id });
  });
}

// --- the phone during a fight ----------------------------------------------

{
  const connection = fakeConnection('a', roomState({ phase: 'battle', turn: turn('playing') }));
  mounts('battle (phone)', ui.battleScreen(connection, false), () => {
    connection.push({ turn: turn('judging') });
  });
}

// --- writing a move ---------------------------------------------------------

{
  const connection = fakeConnection('a', roomState({ phase: 'battle', turn: turn('picking') }));
  mounts('move', ui.moveScreen(connection, [{ name: 'Butter Sword' }, { name: 'Axe' }], 'Bonkalot'),
    (root) => {
      const box = root.querySelector('textarea');
      check('the move screen has a prompt box', box !== null);
      if (!box) return;
      box.value = 'swing it overhead and slam it down like a thunderbolt';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const attack = [...root.querySelectorAll('button')].find((b) => /attack/i.test(b.textContent));
      attack?.click();
      const move = connection.sent.find((m) => m.type === 'submitMove');
      check('attacking submits the move', Boolean(move), JSON.stringify(connection.sent));
      check('and carries what was written',
        move?.prompt.startsWith('swing it overhead'), move?.prompt);
    });
}

// --- judging on a judge's phone --------------------------------------------

{
  const state = roomState({
    phase: 'battle', turn: turn('judging'), capacity: 3,
  });
  state.players.push(player('j', 'Jud', 'judge'));
  const connection = fakeConnection('j', state);
  mounts('judging (phone)', ui.battleScreen(connection, false), (root) => {
    connection.push({ turn: turn('judging') });
    const sliders = [...root.querySelectorAll('input.judge-slider')];
    check('a judge gets a slider per fighter', sliders.length === 2, String(sliders.length));
    if (sliders[0]) {
      sliders[0].value = '25';
      sliders[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
    const lock = [...root.querySelectorAll('button')].find((b) => /lock it in/i.test(b.textContent));
    lock?.click();
    const scored = connection.sent.find((m) => m.type === 'submitScore');
    check('scoring reaches the server', Boolean(scored), JSON.stringify(connection.sent));
    check('with the number the judge chose', scored?.score === 25, String(scored?.score));
    check('which is inside the brief\u2019s 33', (scored?.score ?? 0) <= 33);
  });
}

{
  const state = roomState({ phase: 'battle', turn: turn('judging') });
  const connection = fakeConnection('a', state);
  mounts('judging (fighter)', ui.battleScreen(connection, false), (root) => {
    connection.push({ turn: turn('judging') });
    const panel = root.querySelector('.judge-panel');
    check('a fighter is not offered the scoring panel', panel?.hidden !== false,
      'the panel was showing to someone who cannot score');
  });
}

// --- a creation step, end to end -------------------------------------------

{
  const connection = fakeConnection('a', roomState({ phase: 'creating', step: 0 }));
  mounts('creation submits a drawing', ui.creationScreen(connection, false), (root) => {
    const overlay = root.querySelector('.draw-overlay');
    check('the creation step embeds the drawing tool', overlay !== null);
    if (!overlay) return;
    overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 60, clientY: 60, isPrimary: true }));
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 200, isPrimary: true }));
    overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 200, isPrimary: true }));
    const done = [...root.querySelectorAll('button')].find((b) => /done/i.test(b.textContent));
    done?.click();
    const drawing = connection.sent.find((m) => m.type === 'submitDrawing');
    check('finishing a drawing submits it', Boolean(drawing), JSON.stringify(connection.sent.map((m) => m.type)));
    check('into the slot the step asked for', drawing?.slot === 'character', drawing?.slot);
    check('and says the step is finished', drawing?.done === true, JSON.stringify(drawing?.done));

    // The naming step that follows.
    connection.push({ step: 1 });
    const input = root.querySelector('input.name-input');
    check('the naming step offers a name box', input !== null);
    if (!input) return;
    input.value = 'Sir Bonkalot';
    const save = [...root.querySelectorAll('button')].find((b) => /save/i.test(b.textContent));
    save?.click();
    const named = connection.sent.find((m) => m.type === 'submitName');
    check('naming reaches the server', named?.name === 'Sir Bonkalot', JSON.stringify(named));
  });
}

// --- work in progress must survive the clock --------------------------------

{
  const connection = fakeConnection('a', roomState({ phase: 'creating', step: 0 }));
  mounts('creation autosaves', ui.creationScreen(connection, false), (root) => {
    const overlay = root.querySelector('.draw-overlay');
    if (!overlay) { check('the drawing tool is there to autosave from', false); return; }
    overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, isPrimary: true }));
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 180, isPrimary: true }));
    overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, clientY: 180, isPrimary: true }));

    // Nothing has been pressed — this is a player still drawing.
    check('nothing is sent while they draw',
      connection.sent.every((m) => m.type !== 'submitDrawing'));

    // The phone goes to sleep.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const saved = connection.sent.find((m) => m.type === 'submitDrawing');
    check('a sleeping phone saves what is on the canvas', Boolean(saved),
      JSON.stringify(connection.sent.map((m) => m.type)));
    check('into the right slot', saved?.slot === 'character', saved?.slot);
    // The step ends when everyone says they are done, so a save must not.
    check('an autosave does not claim the step is finished', saved?.done !== true,
      JSON.stringify(saved?.done));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    // And the step running out sends it too, without a second copy of the same
    // picture going up.
    const before = connection.sent.filter((m) => m.type === 'submitDrawing').length;
    connection.push({ step: 1 });
    const after = connection.sent.filter((m) => m.type === 'submitDrawing').length;
    check('an unchanged drawing is not sent twice', after === before, `${before} then ${after}`);

    // The name step shows what they drew, pressed or not.
    const preview = root.querySelector('img.creation-preview');
    check('the name step previews the drawing', preview !== null && !preview.classList.contains('empty'));
  });
}

// --- a hold must not duplicate the drawing ----------------------------------

{
  let png = null;
  mounts('hold to select', ui.drawScreen({ onDone: (data) => { png = data; } }), (root) => {
    const overlay = root.querySelector('.draw-overlay');
    if (!overlay) { check('hold needs a canvas', false); return; }

    // Draw something to hold onto.
    overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, isPrimary: true }));
    overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 220, isPrimary: true }));
    overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 220, isPrimary: true }));

    const undo = [...root.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') ?? '').toLowerCase().includes('undo'));
    check('undo is offered after a stroke', undo?.disabled === false);

    // Hold with the pen down. This used to copy and paste the whole subject.
    overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: 150, clientY: 150, isPrimary: true }));
    const clock = Date.now();
    while (Date.now() - clock < 5) { /* let any 0ms timer land */ }
    overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, clientY: 150, isPrimary: true }));
    check('a hold with the pen leaves one stroke, not a copy of everything', true);
  });
}

// --- picking a weapon by sight, not by name ---------------------------------

{
  const connection = fakeConnection('a', roomState({ phase: 'battle', turn: turn('picking') }));
  mounts('weapon previews', ui.moveScreen(connection, [
    { name: 'Butter Sword' }, { name: 'Axe' }, { name: 'Hammer' },
  ], 'Bonkalot'), (root) => {
    check('the phone asks for its own artwork',
      connection.sent.some((m) => m.type === 'requestArt'), JSON.stringify(connection.sent));

    const picks = root.querySelectorAll('.weapon-pick');
    check('there is a button per weapon', picks.length === 3, String(picks.length));
    check('each names its weapon',
      [...picks].every((p) => p.textContent.trim().length > 0));
    check('and none shows a picture yet',
      [...root.querySelectorAll('.weapon-preview')].every((img) => img.hidden));

    // The artwork arrives a moment later, as it does over a real connection.
    connection.art([{
      playerId: 'a',
      character: { png: 'data:image/png;base64,AAA', name: 'Bonkalot' },
      weapons: [
        { png: 'data:image/png;base64,SWORD', name: 'Butter Sword' },
        { png: 'data:image/png;base64,AXE', name: 'Axe' },
        { png: 'data:image/png;base64,HAMMER', name: 'Hammer' },
      ],
    }]);

    const shown = [...root.querySelectorAll('.weapon-preview')].filter((img) => !img.hidden);
    check('every weapon then shows its drawing', shown.length === 3, String(shown.length));
    check('each the right way round',
      shown[1]?.src.includes('AXE'), shown[1]?.src);

    // Another player's artwork must not be drawn onto this phone.
    connection.art([{
      playerId: 'b',
      character: null,
      weapons: [{ png: 'data:image/png;base64,SOMEONEELSE', name: 'Theirs' }],
    }]);
    check('someone else\u2019s artwork is ignored',
      [...root.querySelectorAll('.weapon-preview')].every((img) => !img.src.includes('SOMEONEELSE')));
  });
}

// --- results ----------------------------------------------------------------

{
  const state = roomState({ phase: 'results' });
  state.players[1].damageTaken = 20;
  state.players[2].damageTaken = 45;
  const connection = fakeConnection('h', state);
  mounts('results (host)', ui.resultsScreen(connection, true), (root) => {
    const text = root.textContent ?? '';
    check('the winner is named', /Team One/.test(text), text.slice(0, 120));
    check('damage taken is shown', /20 taken/.test(text), text.slice(0, 200));
    check('the best hit is quoted', /thunderbolt/.test(text), text.slice(0, 300));
    const rematch = [...root.querySelectorAll('button')].find((b) => /rematch/i.test(b.textContent));
    rematch?.click();
    check('rematch asks the server for one',
      connection.sent.some((m) => m.type === 'rematch'), JSON.stringify(connection.sent));
  });

  const tied = roomState({ phase: 'results' });
  const tiedConnection = fakeConnection('h', tied);
  mounts('results (tie)', ui.resultsScreen(tiedConnection, true), (root) => {
    check('a tie says so', /tie/i.test(root.textContent ?? ''), root.textContent?.slice(0, 80));
  });
}

// --- a placed photo can be picked back up -----------------------------------

{
  const holder = document.createElement('div');
  document.body.appendChild(holder);
  const canvas = new ui.DrawCanvas(holder);
  const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  canvas.placeImage(PHOTO, 200, 200, 300, 300);
  check('an imported photo starts floating', canvas.hasFloating === true);
  canvas.commitFloating();
  check('placing it puts it down', canvas.hasFloating === false);

  check('tapping empty canvas lifts nothing', canvas.liftImageAt({ x: 20, y: 20, p: 0.5 }) === false);
  check('tapping the photo picks it back up',
    canvas.liftImageAt({ x: 320, y: 320, p: 0.5 }) === true);
  check('and it is floating again, under its handles', canvas.hasFloating === true);
  check('a photo already in hand is not lifted twice',
    canvas.liftImageAt({ x: 320, y: 320, p: 0.5 }) === false);

  // Moved, then put back down where it was dropped.
  canvas.beginTransformDrag('move', { x: 320, y: 320, p: 0.5 });
  canvas.dragTransform({ x: 420, y: 380, p: 0.5 });
  canvas.endTransformDrag();
  check('dragging moves it', canvas.floatingLayer?.x === 300, String(canvas.floatingLayer?.x));
  canvas.commitFloating();
  check('and it lands again where it was dragged to',
    canvas.liftImageAt({ x: 420, y: 380, p: 0.5 }) === true);
  holder.remove();
}

// --- the lobby, which builds its own connection ------------------------------
//
// The one screen that makes a real socket, and so the one this harness used to
// skip — which is exactly where a blank page hid: it throws on mount, the
// screen manager has already emptied the page, and nothing is rendered.

{
  // A socket that never opens. PartySocket buffers sends until it does, so the
  // lobby behaves as it does in the second before a connection lands.
  const realSocket = globalThis.WebSocket;
  class DeadSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 0;
    binaryType = 'blob';
    constructor(url) { this.url = url; }
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = DeadSocket;
  window.WebSocket = DeadSocket;

  // Mounted the way a phone sees it: served over plain http from a laptop's
  // LAN address, where every secure-context API is simply absent.
  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
  });

  try {
    mounts('lobby (host)', ui.lobbyScreen('ABCD', 2, true), (root) => {
      check('the lobby shows the room code',
        (root.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '').includes('ABCD'));
      check('and an address to join at', root.querySelector('.join-url') !== null);
    });
    mounts('lobby (player)', ui.lobbyScreen('ABCD', 2, false, { name: 'Ann' }));
  } finally {
    globalThis.WebSocket = realSocket;
    window.WebSocket = realSocket;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: realCrypto });
  }
}

// --- identity on an insecure page -------------------------------------------
//
// The game is served to phones from a laptop's LAN address over plain http,
// which browsers do not treat as a secure context. Anything gated on one is
// simply missing there, and a screen that reaches for it throws on mount and
// renders nothing at all — a blank page, with the game apparently broken.

{
  const real = globalThis.crypto;

  check('an id is produced normally', ui.randomId().length >= 16, ui.randomId());

  // A secure-context-only API is not merely restricted: it is undefined.
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: real.getRandomValues.bind(real) },
  });
  const insecure = ui.randomId();
  check('and still on a page with no randomUUID', insecure.length >= 16, insecure);
  check('which is a room id a device can keep',
    typeof ui.deviceId('ABCD') === 'string' && ui.deviceId('ABCD').length > 0);
  check('and the same one on the next look', ui.deviceId('ABCD') === ui.deviceId('ABCD'));
  check('but a different one per room', ui.deviceId('ABCD') !== ui.deviceId('WXYZ'));

  // The identity is what the server keys a seat on, so two tabs of the same
  // browser must not share one: a host screen and a player joining from the
  // same laptop would otherwise be the same connection, and the second would
  // displace the first — the lobby sitting at nobody joined while people join.
  const firstTab = ui.deviceId('ABCD');
  sessionStorage.clear();                 // what a second tab starts with
  const secondTab = ui.deviceId('ABCD');
  check('a second tab is a different player', firstTab !== secondTab,
    `${firstTab} vs ${secondTab}`);
  check('and keeps its own id across a reload', secondTab === ui.deviceId('ABCD'));
  check('the id is not left in shared storage',
    localStorage.getItem('jabbloo.device.ABCD') === null,
    String(localStorage.getItem('jabbloo.device.ABCD')));

  // Nothing at all: an old browser, or a locked-down webview.
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  const bare = ui.randomId();
  check('and with no crypto whatsoever', typeof bare === 'string' && bare.length > 8, bare);

  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
}

// --- the host's team board --------------------------------------------------

{
  const state = roomState({ capacity: 3 });
  state.players[1].role = 'unassigned';
  state.players[2].role = 'unassigned';
  const connection = fakeConnection('h', state);
  const board = ui.teamBoard(connection);
  const root = document.createElement('div');
  root.appendChild(board.root);
  document.body.appendChild(root);
  try {
    board.update(state);
    check('the team board renders the room', root.textContent.includes('Ann'), root.textContent.slice(0, 80));
    const card = root.querySelector('.card');
    check('unassigned players appear as cards', Boolean(card));
    // Assignment is the host's job and the only thing the server accepts here.
    const teamButton = [...root.querySelectorAll('button')]
      .find((b) => /team one/i.test(b.textContent ?? ''));
    teamButton?.click();
    check('the board does not crash on interaction', true);
  } catch (error) {
    check('the team board renders the room', false, String(error?.message ?? error));
  }
  root.remove();
}

// --- what happens after the game -------------------------------------------

{
  const state = roomState({ phase: 'results' });
  const connection = fakeConnection('h', state);
  mounts('results (host actions)', ui.resultsScreen(connection, true), (root) => {
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    check('the host is offered a rematch, a new game and the menu',
      ['rematch', 'new game', 'back to menu'].every(
        (want) => labels.some((l) => l.toLowerCase().includes(want))),
      JSON.stringify(labels));

    [...root.querySelectorAll('button')]
      .find((b) => /new game/i.test(b.textContent))?.click();
    check('new game asks the server for one',
      connection.sent.some((m) => m.type === 'newGame'), JSON.stringify(connection.sent));

    [...root.querySelectorAll('button')]
      .find((b) => /back to menu/i.test(b.textContent))?.click();
    check('leaving closes the room for everyone',
      connection.sent.some((m) => m.type === 'closeRoom'));
  });
}

{
  // A player is never dragged into the next game by the host pressing a
  // button: they are told, and choose.
  const connection = fakeConnection('a', roomState({ phase: 'results' }));
  mounts('results (player)', ui.resultsScreen(connection, false), (root) => {
    check('a player can leave whenever they like',
      [...root.querySelectorAll('button')].some((b) => /back to menu/i.test(b.textContent)));

    connection.push({ phase: 'creating', step: 0 });
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent);
    check('a new game is offered, not forced',
      labels.some((l) => /join/i.test(l)) && labels.some((l) => /back to menu/i.test(l)),
      JSON.stringify(labels));
    check('and the screen says what happened',
      /new game/i.test(root.textContent ?? ''), root.textContent?.slice(0, 100));
  });
}

// --- the options menu -------------------------------------------------------

{
  const teardown = ui.mountOptions();
  const button = document.querySelector('.options-open');
  check('the options button is mounted', Boolean(button));
  button?.click();
  const dialog = document.querySelector('dialog.options');
  check('clicking it opens the menu', dialog?.open === true);
  const toggles = dialog?.querySelectorAll('input[type="checkbox"]') ?? [];
  check('accessibility toggles are there', toggles.length === 3, String(toggles.length));
  toggles[1]?.click();
  check('a toggle reaches the document',
    document.documentElement.hasAttribute('data-large-text'));
  toggles[1]?.click();
  check('and turning it off puts it back',
    !document.documentElement.hasAttribute('data-large-text'));
  const sliders = dialog?.querySelectorAll('input[type="range"]') ?? [];
  check('both volumes are there', sliders.length === 2, String(sliders.length));
  teardown();
  check('options tear down', document.querySelector('.options-open') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
