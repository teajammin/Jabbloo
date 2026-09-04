import { bubbleText } from './bubbleText';
import { el, button, goHome, type Screen } from './screens';
import { RoomConnection } from '../net/room';
import { canStart, type Player, type RoomState } from '../shared/protocol';

interface JoinDetails {
  name: string;
  photo?: string | undefined;
}

/**
 * The lobby, for both the host screen and the players' phones.
 *
 * One screen rather than two because the state is identical — only the
 * affordances differ. The host sees the code, the roster and Start; a phone
 * sees confirmation that it is in and who else has arrived.
 *
 * Team assignment is deliberately absent: the brief puts the drag onto the
 * host laptop, and that lands in the next task.
 */
export function lobbyScreen(
  code: string,
  capacity: number,
  isHost: boolean,
  join?: JoinDetails,
): Screen {
  return (root, go) => {
    const connection = new RoomConnection(code);

    const roster = el('ul', { class: 'roster' });
    const status = el('p', { class: 'lede' }, 'Connecting…');
    status.setAttribute('role', 'status');
    const error = el('p', { class: 'error' });
    error.setAttribute('role', 'alert');

    const startButton = button('Start', () => connection.send({ type: 'start' }), 'big primary');
    startButton.disabled = true;

    function renderRoster(state: RoomState): void {
      const players = state.players.filter((p) => !p.isHost);
      roster.replaceChildren();

      for (const player of players) {
        roster.appendChild(playerRow(player, player.id === connection.playerId));
      }

      // Empty seats, so the host can see at a glance who is still missing.
      const waiting = Math.max(0, (state.capacity || capacity) - players.length);
      for (let i = 0; i < waiting; i++) {
        roster.appendChild(el('li', { class: 'player empty' }, el('span', {}, 'Waiting…')));
      }
    }

    connection.on({
      onWelcome: () => {
        error.textContent = '';
      },
      onState: (state) => {
        renderRoster(state);
        const players = state.players.filter((p) => !p.isHost);
        const target = state.capacity || capacity;

        status.textContent = isHost
          ? players.length >= target
            ? 'Everyone is in.'
            : `${players.length} of ${target} joined.`
          : `You're in. ${players.length} here so far.`;

        startButton.disabled = !canStart(state);

        if (state.phase !== 'lobby') {
          status.textContent = 'Starting…';
        }
      },
      onError: (reason) => {
        error.textContent = reason;
      },
      onClose: () => {
        status.textContent = 'Disconnected. Trying to reconnect…';
      },
    });

    // Declare what this connection is, once the socket is live.
    const announce = () => {
      if (isHost) connection.send({ type: 'host', capacity });
      else if (join) {
        // exactOptionalPropertyTypes: omit `photo` entirely rather than
        // sending an explicit undefined.
        connection.send({
          type: 'join',
          name: join.name,
          ...(join.photo ? { photo: join.photo } : {}),
        });
      }
    };
    // PartySocket buffers until open, so this is safe to send immediately.
    announce();

    const joinUrl = `${location.origin}/?room=${code}`;

    root.append(
      el('main', { class: 'screen screen-lobby' },
        isHost
          ? el('div', { class: 'code-block' },
              el('p', { class: 'lede' }, 'Join at'),
              el('p', { class: 'join-url' }, location.host),
              el('p', { class: 'lede' }, 'with the code'),
              bubbleText(code, { height: 104, jitter: 4, className: 'title' }),
              el('a', { class: 'join-link', href: joinUrl, target: '_blank', rel: 'noreferrer' },
                'or open the direct link'),
            )
          : bubbleText(code, { height: 62, className: 'title' }),
        status,
        roster,
        error,
        isHost
          ? el('div', { class: 'stack' }, startButton, button('Leave', () => {
              connection.close();
              goHome(go);
            }, 'ghost'))
          : el('p', { class: 'help-note' }, 'Keep this page open — the game happens on the big screen.'),
      ),
    );

    return () => connection.close();
  };
}

function playerRow(player: Player, isYou: boolean): HTMLLIElement {
  const avatar = player.photo
    ? el('img', { class: 'avatar', src: player.photo, alt: '' })
    : el('span', { class: 'avatar placeholder' }, player.name.slice(0, 1).toUpperCase());

  const row = el('li', { class: `player${player.connected ? '' : ' offline'}` },
    avatar,
    el('span', { class: 'player-name' }, player.name),
  );
  if (isYou) row.appendChild(el('span', { class: 'you' }, 'you'));
  if (!player.connected) row.appendChild(el('span', { class: 'you' }, 'away'));
  return row;
}
