import { bubbleText } from './bubbleText';
import { el, button, goHome, type Screen } from './screens';
import { MAX_PLAYERS, MIN_PLAYERS, makeRoomCode } from '../shared/protocol';
import { lobbyScreen } from './lobby';

/**
 * Create room: choose how many players, then open the room.
 *
 * The code is generated client-side and used as the PartyKit room id, so no
 * round trip is needed before the host can read it out.
 */
export const createRoomScreen: Screen = (root, go) => {
  let capacity = 2;

  const counts = el('div', { class: 'controls' });
  const buttons: HTMLButtonElement[] = [];

  const select = (value: number) => {
    capacity = value;
    for (const node of buttons) {
      node.setAttribute('aria-pressed', String(Number(node.dataset['count']) === value));
    }
  };

  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const node = button(String(n), () => select(n), 'count');
    node.dataset['count'] = String(n);
    buttons.push(node);
    counts.appendChild(node);
  }
  select(2);

  root.append(
    el('main', { class: 'screen' },
      bubbleText('HOW MANY', { height: 62, className: 'title' }),
      el('p', { class: 'lede' },
        'Everyone joins from their phone. Judges count too — with 3 or 5 players the extras judge.'),
      counts,
      el('div', { class: 'stack' },
        button('Open the room', () => {
          go((r, g) => lobbyScreen(makeRoomCode(), capacity, true)(r, g));
        }, 'big primary'),
        button('Back', () => goHome(go), 'ghost'),
      ),
    ),
  );
};
