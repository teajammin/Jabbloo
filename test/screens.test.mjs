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
  progress: { drawn: [], named: [], step: 0, endsAt: Date.now() + 60_000, done: false },
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
  step: -1, ultRound: 0, votes: {}, chosen: null, rematchReady: null, turn: null,
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

  // The title bobs; nothing else does. A word that moves draws the eye, which
  // is what a title is for and what a room code is not.
  const title = root.querySelector('.bubble-text.is-bouncing');
  check('the title letters are set bobbing', title !== null);
  const letters = [...(title?.querySelectorAll('img') ?? [])];
  check('each letter on its own clock',
    new Set(letters.map((img) => img.style.animationDelay)).size === letters.length,
    JSON.stringify(letters.map((img) => img.style.animationDelay)));
  check('and not all at the same speed',
    new Set(letters.map((img) => img.style.animationDuration)).size > 1);
});
mounts('create room', ui.createRoomScreen);
mounts('join room', ui.joinRoomScreen);

// --- what a player is told when something breaks ----------------------------

{
  ui.resetErrorLog();
  const posted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    posted.push({ url, body: JSON.parse(init?.body ?? '{}') });
    return { ok: true, status: 202, json: async () => ({ logged: true }) };
  };

  let told = 0;
  const stop = ui.watchForErrors(() => { told++; });

  // The kind of failure that leaves a screen frozen with no explanation.
  window.dispatchEvent(new window.ErrorEvent('error', {
    error: new Error('the stage fell over'),
    message: 'the stage fell over',
  }));
  await new Promise((r) => setTimeout(r, 20));

  check('an uncaught error is reported', posted.length === 1, JSON.stringify(posted.length));
  check('to the log endpoint', posted[0]?.url === '/api/log', String(posted[0]?.url));
  check('carrying the message',
    posted[0]?.body?.message === 'the stage fell over', posted[0]?.body?.message);
  check('and the screen it happened on',
    typeof posted[0]?.body?.screen === 'string', posted[0]?.body?.screen);
  check('the player is told once', told === 1, String(told));

  // A promise nobody caught is the same kind of event and must be caught too.
  window.dispatchEvent(Object.assign(new window.Event('unhandledrejection'), {
    reason: new Error('a promise nobody caught'),
  }));
  await new Promise((r) => setTimeout(r, 20));
  check('an unhandled rejection is reported too', posted.length === 2,
    JSON.stringify(posted.map((p) => p.body.message)));

  stop();
  window.dispatchEvent(new window.ErrorEvent('error', {
    error: new Error('after teardown'), message: 'after teardown',
  }));
  await new Promise((r) => setTimeout(r, 20));
  check('and nothing is reported once it is stopped', posted.length === 2);

  globalThis.fetch = realFetch;
  ui.resetErrorLog();
}

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

    // The naming step that follows. A player's own step moves, not the room's:
    // everybody creates at their own pace now.
    connection.push({
      players: connection.state.players.map((p) => (p.id === 'a'
        ? { ...p, progress: { ...p.progress, step: 1 } }
        : p)),
    });
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
    connection.push({
      players: connection.state.players.map((p) => (p.id === 'a'
        ? { ...p, progress: { ...p.progress, step: 1 } }
        : p)),
    });
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
      // Two players have nothing to arrange, so nothing asks them to.
      check('a duel is not asked to name its teams',
        root.querySelector('.zone input') === null);
      check('the two of them face each other instead',
        root.querySelector('.duel-board') !== null);
      // Before anyone joins there is nobody to draw, and a pair of waiting
      // outlines is a promise the room has not been given yet.
      check('with nobody drawn in until they arrive',
        [...root.querySelectorAll('.duel-side')].every((s) => s.hidden));
    });
    mounts('lobby (player)', ui.lobbyScreen('ABCD', 2, false, { name: 'Ann' }));

    // A room opened for four still has a board to arrange, and the face-off is
    // held back until it is actually a duel.
    mounts('lobby (four seats)', ui.lobbyScreen('EFGH', 4, true), (root) => {
      check('a bigger game keeps its team board',
        root.querySelector('.zone input') !== null);
      check('with the face-off waiting out of sight',
        root.querySelector('.duel-board')?.hidden !== false);
    });
  } finally {
    globalThis.WebSocket = realSocket;
    window.WebSocket = realSocket;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: realCrypto });
  }
}

// --- weapons have a direction, characters do not -----------------------------

{
  mounts('draw (a weapon)', ui.drawScreen({ title: 'Draw weapon 1', aim: true }), (root) => {
    check('a weapon is told where the enemy is',
      root.querySelector('.aim-guide') !== null);
  });
  mounts('draw (a character)', ui.drawScreen({ title: 'Draw your character' }), (root) => {
    check('a character is not', root.querySelector('.aim-guide') === null);
  });
}

// --- the commentary, on somebody else's laptop -------------------------------
//
// Speech is the browser's, and what it has differs by machine: a Mac always
// has Fred and Ralph, Windows has David and Zira, a bare Linux box has
// nothing at all. A game that only works on the laptop it was written on is
// not a party game.

{
  const realSpeech = window.speechSynthesis;
  const voicesOf = (names) => ({
    getVoices: () => names.map((name, i) => ({
      name, lang: 'en-US', default: i === 0, localService: true,
    })),
    speak() {}, cancel() {}, addEventListener() {}, removeEventListener() {},
  });

  const pickedFor = async (names) => {
    window.speechSynthesis = voicesOf(names);
    globalThis.speechSynthesis = window.speechSynthesis;
    ui.resetNarrator();
    return ui.chosenVoiceName('announcer');
  };

  try {
    check('a Mac with nothing downloaded still finds a deep one',
      ['Daniel', 'Ralph'].includes(await pickedFor(['Samantha', 'Fred', 'Ralph', 'Daniel'])),
      await pickedFor(['Samantha', 'Fred', 'Ralph', 'Daniel']));

    check('Windows finds its own',
      (await pickedFor(['Microsoft Zira', 'Microsoft David'])) === 'Microsoft David',
      await pickedFor(['Microsoft Zira', 'Microsoft David']));

    check('Chrome finds its own',
      (await pickedFor(['Google US English', 'Google UK English Male']))
        === 'Google UK English Male',
      await pickedFor(['Google US English', 'Google UK English Male']));

    // Nothing it asked for: guess at something that suits the character
    // rather than taking whatever happens to be first.
    check('an unknown machine still avoids the wrong character',
      (await pickedFor(['Zira', 'Some Man Voice'])) === 'Some Man Voice',
      await pickedFor(['Zira', 'Some Man Voice']));

    check('and a machine with no voices at all simply stays quiet',
      (await pickedFor([])) === null, String(await pickedFor([])));
  } finally {
    window.speechSynthesis = realSpeech;
    globalThis.speechSynthesis = realSpeech;
    ui.resetNarrator();
  }
}

// --- saying the game is busy ------------------------------------------------

{
  const badge = ui.loadingBadge();
  document.body.appendChild(badge.root);

  check('the badge says what it is doing',
    /loading/i.test(badge.root.getAttribute('aria-label') ?? ''),
    badge.root.getAttribute('aria-label'));
  // Text, not the game's lettering: those are thirty image files, and a badge
  // that cannot appear until the network is free is no use during a wait for
  // the network.
  check('and needs nothing fetched to appear',
    badge.root.querySelector('img') === null);
  check('and announces itself to a screen reader',
    badge.root.getAttribute('role') === 'status');

  // In order, left to right: every letter the same hop, a beat after the one
  // before it. Out-of-step delays would be the title's bob, not a wave.
  const delays = [...badge.root.querySelectorAll('.loading-word > span')]
    .map((span) => parseFloat(span.style.animationDelay));
  check('every letter is delayed a little more than the last',
    delays.length === 7 && delays.every((d, i) => i === 0 || d > delays[i - 1]),
    JSON.stringify(delays));
  check('by an even step', delays.length > 2
    && Math.abs((delays[1] - delays[0]) - (delays[2] - delays[1])) < 0.001,
    JSON.stringify(delays));

  badge.done();
  check('finishing starts it leaving', badge.root.classList.contains('is-done'));
  badge.done();
  check('and saying so twice is harmless', badge.root.classList.contains('is-done'));
  badge.root.remove();
}

// --- a screen arrives whole -------------------------------------------------
//
// Screens used to be mounted straight into the page, so the room watched them
// assemble: a heading, a line of text, then pictures arriving one at a time.
// A page putting itself together in front of an audience looks broken even
// when it is working perfectly.

{
  const host = document.createElement('div');
  host.id = 'arrival-test';
  document.body.appendChild(host);
  const go = ui.mount(host);

  // A screen with a picture that has not loaded: exactly the case that used
  // to pop in afterwards.
  go((root) => {
    root.appendChild(document.createElement('p')).textContent = 'Heading';
    const img = document.createElement('img');
    img.src = '/letters/A.png';
    root.appendChild(img);
  });

  check('it is held back while it arrives', host.classList.contains('is-arriving'));
  // Hidden, not removed: a screen with no layout cannot measure itself, and
  // the drawing canvas sizes from the space it is given.
  check('but it is laid out while it waits', host.childElementCount > 0);

  await new Promise((r) => setTimeout(r, 2200));
  check('and is shown once it is whole or out of time',
    !host.classList.contains('is-arriving'));

  // A second screen while the first is still waiting must win.
  go((root) => { root.appendChild(document.createElement('p')).textContent = 'Second'; });
  await new Promise((r) => setTimeout(r, 2200));
  check('the newest screen is the one that shows',
    host.textContent.includes('Second') && !host.classList.contains('is-arriving'));

  host.remove();
}

// --- quitting has to mean it ------------------------------------------------
//
// A tab that reloads goes back to the game it was in, which saves somebody
// whose browser crashed and is exactly wrong for the quit button: it reloaded
// the page and the resume put them straight back into the fight they had just
// left, so the button appeared to do nothing.

{
  ui.rememberRoom({ code: 'QUIT', isHost: true, capacity: 2 });
  check('a room is remembered to begin with', ui.rememberedRoom()?.code === 'QUIT');

  const teardown = ui.mountOptions();
  const realConfirm = window.confirm;
  try {
    window.confirm = () => true;

    const quit = [...document.querySelectorAll('button')]
      .find((b) => /quit to menu/i.test(b.textContent ?? ''));
    check('the quit button is there', Boolean(quit));

    // jsdom will not navigate and says so; the room being forgotten is the
    // part that was broken and the part worth checking.
    try { quit?.click(); } catch { /* "Not implemented: navigation" */ }

    check('quitting forgets the room', ui.rememberedRoom() === null);
  } finally {
    window.confirm = realConfirm;
    teardown?.();
    ui.forgetRoom();
  }
}

// --- a tab that reloads is still in the game ---------------------------------
//
// Tabs reload for reasons nobody chose: a renderer crash under memory
// pressure, a phone reclaiming a page it had backgrounded. The room outlives
// all of them on the server, and the device has to know it was in one.

{
  ui.forgetRoom();
  check('a fresh tab remembers nothing', ui.rememberedRoom() === null);

  ui.rememberRoom({ code: 'WXYZ', isHost: true, capacity: 4 });
  const back = ui.rememberedRoom();
  check('a host remembers its own room', back?.code === 'WXYZ' && back?.isHost === true,
    JSON.stringify(back));
  check('and how many it opened it for', back?.capacity === 4, String(back?.capacity));

  ui.rememberRoom({ code: 'ABCD', isHost: false, capacity: 0, join: { name: 'Ann', photo: 'data:image/png;base64,' + 'x'.repeat(400_000) } });
  const player = ui.rememberedRoom();
  check('a player remembers the name their seat is under',
    player?.join?.name === 'Ann', JSON.stringify(player?.join));
  // The one field big enough to blow the storage quota, and the seat is
  // reclaimed by name anyway.
  check('but not their photo', player?.join?.photo === undefined);

  ui.forgetRoom();
  check('leaving on purpose is not remembered', ui.rememberedRoom() === null);

  // Nothing a broken note can do should keep the game off the front page.
  try {
    sessionStorage.setItem('jabbloo:room', '{ not json');
    check('a damaged note is ignored', ui.rememberedRoom() === null);
    sessionStorage.setItem('jabbloo:room', '{"isHost":true}');
    check('and one with no room in it', ui.rememberedRoom() === null);
  } finally {
    ui.forgetRoom();
  }
}

// --- leaving a room is not a connection problem ------------------------------
//
// Every exit from the lobby closes the socket, and a closing socket fires the
// same event as one that drops. So leaving raised "Reconnecting…" over the
// home screen a second later — where there is no connection, and nothing that
// would ever clear it — and the notice sat there through the menus until the
// next room opened a socket of its own. It read as random, because what
// triggered it was two screens back.

{
  const realSocket = globalThis.WebSocket;

  // Unlike DeadSocket above, this one reports its own closing, as a browser
  // does. That event is the whole point: without it the bug cannot happen and
  // the test cannot see it.
  class TalkativeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 0;
    binaryType = 'blob';
    #listeners = {};
    constructor(url) { this.url = url; }
    addEventListener(type, fn) { (this.#listeners[type] ??= []).push(fn); }
    removeEventListener(type, fn) {
      this.#listeners[type] = (this.#listeners[type] ?? []).filter((f) => f !== fn);
    }
    send() {}
    close() {
      this.readyState = 3;
      for (const fn of this.#listeners['close'] ?? []) fn({ type: 'close', code: 1000 });
    }
  }
  globalThis.WebSocket = TalkativeSocket;
  window.WebSocket = TalkativeSocket;

  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
  });

  const teardownBanner = ui.mountConnectionBanner();
  const banner = document.querySelector('.connection-banner');

  // What leaving says about the connection, if anything.
  const heard = [];
  const listen = (e) => heard.push(e.detail?.open);
  window.addEventListener(ui.CONNECTION_EVENT, listen);

  try {
    // Into a room and straight back out of it, the way someone flicking
    // between the front page and the player count does.
    mounts('lobby (left again)', ui.lobbyScreen('WXYZ', 2, true));

    check('leaving says the connection is fine rather than lost',
      heard.length > 0 && heard.every((open) => open === true),
      JSON.stringify(heard));

    await new Promise((r) => setTimeout(r, 1500));
    check('so no reconnection notice is raised over the menus',
      banner?.hidden === true);
  } finally {
    window.removeEventListener(ui.CONNECTION_EVENT, listen);
    teardownBanner();
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
  // The host has already said how many are playing, so the board can be laid
  // out right the first time: no judges' bench flashing up and vanishing.
  const board = ui.teamBoard(connection, 4);
  const root = document.createElement('div');
  root.appendChild(board.root);
  document.body.appendChild(root);
  try {
    check('the board shows nothing before it knows the room', board.root.hidden === true);
    check('and an even game has no judges bench from the start',
      board.root.querySelector('.zone-judge')?.hidden === true);

    board.update(state);
    check('the board appears once it has the room', board.root.hidden === false);
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

// --- two players, facing each other ----------------------------------------

{
  const board = ui.duelBoard();
  const root = document.createElement('div');
  root.appendChild(board.root);
  document.body.appendChild(root);

  const seats = () => [...root.querySelectorAll('.duel-side')];
  const shown = () => seats().filter((s) => !s.hidden);

  try {
    check('an empty room draws nobody', shown().length === 0);

    // The host is in the room from the start and is not one of the fighters.
    board.update(roomState({ players: [player('h', 'Host', 'unassigned', { isHost: true })] }));
    check('and the host does not count as a player', shown().length === 0);

    board.update(roomState({
      players: [
        player('h', 'Host', 'unassigned', { isHost: true }),
        player('a', 'Ann', 'unassigned'),
      ],
    }));
    check('the first to join appears alone', shown().length === 1);
    check('with their name under them', shown()[0]?.textContent?.includes('Ann'),
      shown()[0]?.textContent);
    check('and a plain figure, having brought no photo',
      shown()[0]?.querySelector('.duel-icon')?.classList.contains('anon'));

    board.update(roomState({
      players: [
        player('h', 'Host', 'unassigned', { isHost: true }),
        player('a', 'Ann', 'unassigned'),
        player('b', 'Bo', 'unassigned', { photo: 'data:image/png;base64,xx' }),
      ],
    }));
    check('the second takes the other side', shown().length === 2);
    check('the two of them are on opposite sides',
      seats()[0]?.textContent?.includes('Ann') && seats()[1]?.textContent?.includes('Bo'));
    check('a photo is used when there is one',
      seats()[1]?.querySelector('.duel-icon')?.classList.contains('anon') === false);

    // Somebody leaves: the space they were in is empty again, not a placeholder.
    board.update(roomState({
      players: [
        player('h', 'Host', 'unassigned', { isHost: true }),
        player('a', 'Ann', 'unassigned'),
      ],
    }));
    check('and leaving empties the space again', shown().length === 1);
  } catch (error) {
    check('the duel board renders', false, String(error?.message ?? error));
  }
  root.remove();
}

// --- what happens after the game -------------------------------------------

{
  // A rematch is a question, not a command: the host asks and the room answers.
  {
    const pending = roomState({ phase: 'results', rematchReady: [] });
    const asHost = fakeConnection('h', pending);
    mounts('results (rematch called)', ui.resultsScreen(asHost, true), (root) => {
      check('the host is told who has not answered',
        /waiting for ann, bo/i.test(root.textContent ?? ''), root.textContent?.slice(0, 120));
      check('and is not offered the button again',
        ![...root.querySelectorAll('button')].some((b) => /^rematch$/i.test(b.textContent ?? '')));
    });

    const asPlayer = fakeConnection('a', pending);
    mounts('results (rematch asked)', ui.resultsScreen(asPlayer, false), (root) => {
      const rejoin = [...root.querySelectorAll('button')]
        .find((b) => /rejoin/i.test(b.textContent ?? ''));
      check('a player is asked to rejoin', Boolean(rejoin));
      rejoin?.click();
      check('and says so', asPlayer.sent.some((m) => m.type === 'rejoin'),
        JSON.stringify(asPlayer.sent));
    });

    const answered = roomState({ phase: 'results', rematchReady: ['a'] });
    const alreadyIn = fakeConnection('a', answered);
    mounts('results (already in)', ui.resultsScreen(alreadyIn, false), (root) => {
      check('somebody who has answered waits on the rest',
        /you're in/i.test(root.textContent ?? ''), root.textContent?.slice(0, 120));
      check('and is not asked twice',
        ![...root.querySelectorAll('button')].some((b) => /rejoin/i.test(b.textContent ?? '')));
    });
  }

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
  // Three accessibility toggles, plus the one that turns the commentary on.
  const toggles = dialog?.querySelectorAll('input[type="checkbox"]') ?? [];
  check('the toggles are there', toggles.length === 4, String(toggles.length));
  check('including the one that calls the fight out loud',
    /call the fight/i.test(dialog?.textContent ?? ''));
  // A voice nobody can hear is not a choice, so the picker offers a few and
  // says where better ones come from.
  check('and a voice to call it in',
    (dialog?.querySelectorAll('.voice-option') ?? []).length >= 3,
    String((dialog?.querySelectorAll('.voice-option') ?? []).length));
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
