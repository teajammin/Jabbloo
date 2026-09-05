/**
 * Jabbloo entry point.
 *
 * Screens are DOM; the battle stage will be the Pixi canvas inside one of
 * them. The engine sandbox lives separately at /sandbox.html.
 */

import './styles.css';
import { mount, setHome } from './ui/screens';
import { initAxeCursor } from './ui/cursor';
import { launchScreen } from './ui/launch';
import { joinRoomScreen } from './ui/joinRoom';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app missing');

initAxeCursor();
setHome(launchScreen);
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
  // A shared link (/?room=ABCD) drops straight into joining, code prefilled.
  go(params.has('room') ? joinRoomScreen : launchScreen);
}
