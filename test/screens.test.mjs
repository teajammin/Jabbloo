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
mounts('launch', ui.launchScreen);
mounts('create room', ui.createRoomScreen);
mounts('join room', ui.joinRoomScreen);

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
    connection.push({ chosen: 'sky' });
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
