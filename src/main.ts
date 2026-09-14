/**
 * Jabbloo entry point.
 *
 * Screens are DOM; the battle stage will be the Pixi canvas inside one of
 * them. The engine sandbox lives separately at /sandbox.html.
 */

import './styles.css';
import { mount, setHome } from './ui/screens';
import { mountOptions } from './ui/options';
import { mountConnectionBanner } from './ui/connection';
import { rememberedRoom } from './ui/resume';
import { warmGlyphs } from './ui/bubbleText';
import { mountBackdrop } from './ui/backdrop';
import { watchForErrors } from './errors';
import { loadSettings } from './settings';
import { launchScreen } from './ui/launch';
import { joinRoomScreen } from './ui/joinRoom';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app missing');

/**
 * Tells the player when the game has broken.
 *
 * A screen that has stopped responding with no explanation is worse than an
 * apology: the player does not know whether to wait, reload, or tell someone.
 */
function showBreakage(): void {
  if (document.querySelector('.breakage')) return;
  const banner = document.createElement('div');
  banner.className = 'breakage';
  banner.setAttribute('role', 'alert');
  banner.textContent = 'Something went wrong. Reloading usually fixes it — '
    + 'your drawings are on the server.';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => location.reload());
  banner.appendChild(reload);

  document.body.appendChild(banner);
}

/*
 * Listening before anything else runs, so a failure while the first screen is
 * being built is caught too — that is precisely the failure nobody would
 * otherwise hear about.
 */
watchForErrors(() => showBreakage());

/*
 * Safari's pinch zoom is not covered by touch-action, and it fires on the
 * two-finger gestures the drawing tool uses to zoom the canvas itself — so a
 * pinch meant for the drawing zoomed the whole page instead, leaving the
 * canvas somewhere off screen.
 */
for (const gesture of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(gesture, (event) => event.preventDefault(), { passive: false });
}

// A double tap is a tap, twice. Without this, the second one zooms.
let lastTap = 0;
document.addEventListener('touchend', (event) => {
  const now = Date.now();
  if (now - lastTap < 320) event.preventDefault();
  lastTap = now;
}, { passive: false });

loadSettings();
setHome(launchScreen);
// Mounted on <body>, not inside a screen: the brief wants options reachable at
// any point in the game, and screens come and go.
// Behind everything, and before anything: the page should never be bare cream
// even for the moment before the first screen mounts.
mountBackdrop();
mountOptions();
// A dropped connection has to be visible wherever it happens, so this lives
// on <body> alongside the options menu rather than inside any one screen.
mountConnectionBanner();
// The alphabet, fetched while the front page is being read, so no heading
// after this one has to assemble itself a letter at a time.
warmGlyphs();
const go = mount(root);

const params = new URLSearchParams(location.search);

// ?draw opens the drawing surface on its own, for trying it on a phone before
// the character-creation flow exists to reach it from.
if (params.has('draw')) {
  const { drawScreen } = await import('./ui/drawScreen');
  go(drawScreen({
    title: 'Drawing sandbox — try it with your finger',
    onDone: (png) => {
      // Nothing consumes the drawing yet; show it so the export can be checked.
      const preview = new Image();
      preview.src = png;
      preview.className = 'photo-preview';
      document.body.appendChild(preview);
    },
  }));
} else {
  /*
   * A tab that was already in a game goes back to it.
   *
   * Tabs reload for reasons nobody chose — a renderer crash under memory
   * pressure, a phone reclaiming a backgrounded page — and the room outlives
   * all of them on the server. Without this the device came back to the front
   * page while its own game carried on without it on the big screen, which is
   * what happened to a host whose laptop crashed mid-fight.
   *
   * A link with a room code in it wins: that is somebody being invited
   * somewhere specific, and it should not be overruled by where they were.
   */
  const previous = params.has('room') ? null : rememberedRoom();

  if (previous) {
    const { lobbyScreen } = await import('./ui/lobby');
    go(lobbyScreen(
      previous.code,
      previous.capacity,
      previous.isHost,
      ...(previous.join ? [previous.join] as const : []),
    ));
  } else {
    // A shared link (/?room=ABCD) drops straight into joining, code prefilled.
    go(params.has('room') ? joinRoomScreen : launchScreen);
  }
}
