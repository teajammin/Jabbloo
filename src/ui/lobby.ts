import { bubbleText } from './bubbleText';
import { el, button, goHome, type Screen } from './screens';
import { RoomConnection } from '../net/room';
import { creationScreen } from './creation';
import { startBlockedBecause, type Player, type RoomState } from '../shared/protocol';
import { teamBoard } from './teams';

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
 * Team assignment appears on the host screen only — the brief puts that drag
 * on the laptop, never on a phone.
 */
export function lobbyScreen(
  code: string,
  capacity: number,
  isHost: boolean,
  join?: JoinDetails,
): Screen {
  return (root, go) => {
    const connection = new RoomConnection(code);
    let handedOver = false;

    const roster = el('ul', { class: 'roster' });
    const status = el('p', { class: 'lede' }, 'Connecting…');
    status.setAttribute('role', 'status');
    const error = el('p', { class: 'error' });
    error.setAttribute('role', 'alert');

    const startButton = button('Start', () => connection.send({ type: 'start' }), 'big primary');
    startButton.disabled = true;

    const board = isHost ? teamBoard(connection) : null;
    const blocked = el('p', { class: 'help-note blocked' });

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
        const players = state.players.filter((p) => !p.isHost);
        const target = state.capacity || capacity;

        // The host arranges on the board; phones just see who is here.
        if (board) board.update(state);
        else renderRoster(state);

        status.textContent = isHost
          ? players.length >= target
            ? 'Everyone is in.'
            : `${players.length} of ${target} joined.`
          : `You're in. ${players.length} here so far.`;

        const reason = startBlockedBecause(state);
        startButton.disabled = reason !== null;
        blocked.textContent = reason ?? '';

        if (state.phase === 'creating') {
          // Hand the live connection over rather than reconnecting: a new
          // socket would be a new player as far as the room is concerned.
          handedOver = true;
          go(creationScreen(connection, isHost));
          return;
        }
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

    // Filled in once the server says which address a phone can reach it on.
    const joinAddress = el('p', { class: 'join-url' }, location.host);
    const joinQr = el('img', { class: 'join-qr', alt: '' });
    joinQr.hidden = true;

    /**
     * Replaces "localhost" with an address a phone can actually type.
     *
     * The laptop's browser only knows the name it was opened under, and on the
     * host that is localhost — the one address on the network that means a
     * different machine to every device that reads it.
     */
    if (isHost) {
      void (async () => {
        try {
          const response = await fetch('/api/lan');
          const { hosts } = await response.json() as { hosts: string[] };
          const host = hosts[0];
          if (!host) return;
          joinAddress.textContent = host;

          // A code is easy to say out loud; an IP address is not, so the host
          // screen carries a QR for it.
          const url = `http://${host}/?room=${code}`;
          const { toDataURL } = await import('qrcode');
          joinQr.src = await toDataURL(url, {
            margin: 1, width: 220, color: { dark: '#4a4458', light: '#fffdf7' },
          });
          joinQr.alt = `Scan to join at ${url}`;
          joinQr.hidden = false;
        } catch {
          // No backend, or no network: the code and the typed address still
          // work, so this is a nicety failing rather than the lobby breaking.
        }
      })();
    }

    root.append(
      el('main', { class: 'screen screen-lobby' },
        isHost
          ? el('div', { class: 'code-block' },
              el('p', { class: 'lede' }, 'Join at'),
              joinAddress,
              el('p', { class: 'lede' }, 'with the code'),
              bubbleText(code, { height: 104, jitter: 4, className: 'title' }),
              joinQr,
              el('a', { class: 'join-link', href: joinUrl, target: '_blank', rel: 'noreferrer' },
                'or open the direct link'),
            )
          : bubbleText(code, { height: 62, className: 'title' }),
        status,
        board ? board.root : roster,
        error,
        isHost
          ? el('div', { class: 'stack' },
              blocked,
              startButton,
              button('Leave', () => {
                connection.close();
                goHome(go);
              }, 'ghost'))
          : el('p', { class: 'help-note' }, 'Keep this page open — the game happens on the big screen.'),
      ),
    );

    return () => {
      // Only closed when leaving the room outright; a handover to the next
      // screen keeps the same socket, and closing it would drop the player.
      if (!handedOver) connection.close();
    };
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
