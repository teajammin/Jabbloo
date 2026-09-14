import { bubbleText, titleHeight } from './bubbleText';
import { el, button, goHome, type Screen } from './screens';
import { RoomConnection } from '../net/room';
import { creationScreen } from './creation';
import {
  isDuel, startBlockedBecause, type Player, type RoomState,
} from '../shared/protocol';
import { teamBoard, duelBoard } from './teams';
import { joinRoomScreen } from './joinRoom';

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

    /*
     * The team board is for games that have teams.
     *
     * With two players there is one possible arrangement and the room makes it
     * at kick-off, so the board would be a puzzle with a single solution
     * standing between two people and their game. A duel gets the two of them
     * facing each other instead — and the team-name boxes were showing right
     * up until the second player arrived, asking the host to name two teams
     * that were never going to exist.
     *
     * Decided from the capacity the host chose, which is known before the room
     * answers, so both are laid out right the first time rather than corrected
     * a moment later.
     */
    const duel = capacity === 2;
    const board = isHost && !duel ? teamBoard(connection, capacity) : null;
    // Built for every host, not only a room opened for two: a game opened for
    // four that only two people turn up to is still a duel, and gets the same
    // face-off rather than a board it can no longer use.
    const versus = isHost ? duelBoard() : null;
    // Laid out right before the room answers, like the board beside it: a
    // face-off that appears and then vanishes when the first state arrives is
    // the same flicker the judges' bench used to have.
    if (versus) versus.root.hidden = !duel;
    const duelNote = el('p', { class: 'lede' }, '');
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

        // The host arranges on the board; phones just see who is here. A duel
        // has nothing to arrange, so the two of them simply face each other.
        const twoPlayers = duel || isDuel(state);
        if (versus) {
          versus.root.hidden = !twoPlayers;
          if (twoPlayers) versus.update(state);
        }
        if (board) {
          board.root.hidden = twoPlayers;
          if (!twoPlayers) board.update(state);
        }
        // The host sees the arrangement, one way or the other; the roster is
        // for the phones, which have nothing to arrange.
        if (!isHost) renderRoster(state);
        roster.hidden = isHost;

        duelNote.textContent = twoPlayers && isHost && players.length === 2
          ? `${players[0]?.name} v ${players[1]?.name}`
          : '';

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
        // A code that names no game is not something to sit and wait on: the
        // player is put back where they can type it again.
        if (/no game with that code/i.test(reason)) {
          window.setTimeout(() => {
            if (!handedOver) {
              connection.leave();
              go(joinRoomScreen);
            }
          }, 2200);
        }
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
        let url = joinUrl;
        try {
          // Development only: on a laptop `location.host` is localhost, which
          // is the one address that means a different machine to every device
          // that reads it. Deployed, the page's own address is already right.
          const response = await fetch('/api/lan');
          // Deployed, there is no such endpoint and the page's own address is
          // already the right one — so a 404 here is an answer, not a failure.
          const body = response.ok
            ? await response.json() as { hosts?: string[] }
            : { hosts: [] };
          const host = body.hosts?.[0];
          if (host) {
            joinAddress.textContent = host;
            url = `http://${host}/?room=${code}`;
          }
        } catch {
          // No dev backend: the page's own address stands.
        }

        try {
          // A code is easy to say out loud; an address is not, so the host
          // screen carries a QR for it.
          const { toDataURL } = await import('qrcode');
          joinQr.src = await toDataURL(url, {
            margin: 1, width: 220, color: { dark: '#4a4458', light: '#fffdf7' },
          });
          joinQr.alt = `Scan to join at ${url}`;
          joinQr.hidden = false;
        } catch {
          // A nicety failing, not the lobby breaking.
        }
      })();
    }

    /*
     * Two columns on the host's screen: how to get in on the left, who is in
     * on the right. The room has to fit a laptop window whole — a Start button
     * you have to scroll to find is a Start button nobody presses.
     */
    root.append(
      el('main', { class: 'screen screen-lobby' },
        isHost
          ? el('div', { class: 'lobby-split' },
              el('div', { class: 'code-block' },
                el('p', { class: 'lede' }, 'Join at'),
                joinAddress,
                joinQr,
                el('p', { class: 'lede' }, 'with the code'),
                bubbleText(code, { height: titleHeight(120), jitter: 4, className: 'title' }),
                el('a', { class: 'join-link', href: joinUrl, target: '_blank', rel: 'noreferrer' },
                  'or open the direct link'),
              ),
              el('div', { class: 'lobby-room' },
                status,
                duelNote,
                ...(versus ? [versus.root] : []),
                ...(board ? [board.root] : []),
                roster,
                error,
                el('div', { class: 'stack' },
                  blocked,
                  startButton,
                  button('Leave', () => {
                    connection.leave();
                    goHome(go);
                  }, 'ghost')),
              ),
            )
          : el('div', { class: 'lobby-player' },
              bubbleText(code, { height: titleHeight(110), className: 'title' }),
              status,
              roster,
              error,
              el('p', { class: 'help-note' },
                'Keep this page open — the game happens on the big screen.'),
              // A player who mistyped the code, or arrived after the game
              // started, had no way out of this screen at all.
              button('Leave', () => {
                connection.leave();
                goHome(go);
              }, 'ghost'),
            ),
      ),
    );

    return () => {
      // Only closed when leaving the room outright; a handover to the next
      // screen keeps the same socket, and closing it would drop the player.
      if (!handedOver) connection.leave();
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
  if (!player.connected) row.appendChild(el('span', { class: 'you' }, 'reconnecting…'));
  return row;
}
