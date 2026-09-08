import { bubbleText } from './bubbleText';
import { el, button, type Screen } from './screens';
import { helpButton, helpDialog } from './help';
import { createRoomScreen } from './createRoom';
import { joinRoomScreen } from './joinRoom';
import { VERSION } from '../version';

/** The launch screen: title, version, create/join, and the help button. */
export const launchScreen: Screen = (root, go) => {
  const dialog = helpDialog();

  root.append(
    el('main', { class: 'screen screen-launch' },
      bubbleText('JABBLOO', { height: 128, jitter: 6, className: 'title' }),
      el('p', { class: 'version' }, `v${VERSION}`),
      el('div', { class: 'stack' },
        button('Create room', () => go(createRoomScreen), 'big primary'),
        button('Join room', () => go(joinRoomScreen), 'big'),
      ),
    ),
    dialog,
    helpButton(dialog),
  );
};
