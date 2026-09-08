import PartySocket from 'partysocket';
import {
  MAX_MESSAGE_BYTES,
  type ClientMessage, type PlayerArt, type RoomState, type ServerMessage,
} from '../shared/protocol';

/**
 * Client-side room connection.
 *
 * Wraps PartySocket so screens deal in typed messages and a state callback
 * rather than raw sockets. The server is authoritative: this never mutates
 * state locally, it only forwards intents and renders what comes back.
 */

/**
 * Where the multiplayer server lives.
 *
 * Falls back to whatever host served the page rather than to `localhost`,
 * because in a real game the page is served to a phone by the host's laptop —
 * and `localhost` on the phone is the phone. This is what let the laptop join
 * its own room while every phone sat on "connecting".
 *
 * A deployed build sets VITE_PARTYKIT_HOST to the real party host instead.
 */
function defaultPartyHost(): string {
  const { hostname, host, protocol } = location;
  // In development Vite serves the page on :5173 while the party server runs
  // beside it on :1999. In production the party worker serves the page itself,
  // so it is simply wherever this page came from — port and all.
  const local = protocol === 'http:'
    && (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname));
  return local ? `${hostname}:1999` : host;
}

const PARTY_HOST = import.meta.env['VITE_PARTYKIT_HOST'] || defaultPartyHost();

/**
 * A stable id for this tab in this room, kept across reloads.
 *
 * The server keys a player's seat — their artwork, their health, their turn —
 * on the connection id. Without one that survives a reload, refreshing a phone
 * would arrive as a stranger, be told the game had already started, and leave
 * a bot playing out a fight for someone standing right there.
 *
 * Session storage, not local storage: local storage is shared by every tab of
 * the same origin, so a host screen and a player joining from the same laptop
 * handed the server the same identity. The second connection displaced the
 * first, the host stopped receiving anything, and the lobby sat at nobody
 * joined while people were joining. Session storage is per tab and still
 * survives the reloads this is for.
 */
export function randomId(): string {
  const source = globalThis.crypto as Crypto | undefined;
  // `crypto.randomUUID` exists only in a secure context, and a game served to
  // phones over a laptop's LAN address is not one — localhost is treated as
  // secure, `http://192.168.x.x` is not. `getRandomValues` has no such
  // restriction, so it is the one to build on.
  if (source?.getRandomValues) {
    const bytes = source.getRandomValues(new Uint8Array(16));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Neither: unique enough to tell two phones in a living room apart.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deviceId(code: string): string {
  const key = `jabbloo.device.${code.toUpperCase()}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const fresh = randomId();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    // No storage: a fresh id every load is the old behaviour, which still
    // plays — it just cannot reclaim a seat.
    return randomId();
  }
}

export interface RoomHandlers {
  onArt?: (art: PlayerArt[]) => void;
  onState?: (state: RoomState) => void;
  onWelcome?: (playerId: string, state: RoomState) => void;
  onError?: (reason: string) => void;
  /** The host shut the room down. */
  onClosed?: () => void;
  onClose?: () => void;
}

/**
 * Tells the interface whether the room is reachable.
 *
 * An event rather than a call into the UI: this module knows about sockets and
 * nothing about screens, and every screen in the game can hear it without
 * being handed a connection to watch.
 */
function announce(open: boolean): void {
  window.dispatchEvent(new CustomEvent(CONNECTION_EVENT, { detail: { open } }));
}

export const CONNECTION_EVENT = 'jabbloo:connection';

export class RoomConnection {
  private readonly socket: PartySocket;
  private handlers: RoomHandlers = {};

  /** Assigned by the server on welcome; identifies this client's player. */
  playerId: string | null = null;
  state: RoomState | null = null;
  private readonly artByPlayer = new Map<string, PlayerArt>();

  constructor(code: string) {
    this.socket = new PartySocket({
      host: PARTY_HOST,
      room: code.toUpperCase(),
      id: deviceId(code),
    });

    this.socket.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'welcome':
          this.playerId = message.playerId;
          this.state = message.state;
          this.handlers.onWelcome?.(message.playerId, message.state);
          this.handlers.onState?.(message.state);
          break;
        case 'state':
          this.state = message.state;
          this.handlers.onState?.(message.state);
          break;
        case 'art':
          // Sent one player at a time — six characters and eighteen weapons in
          // a single message would be past the platform's limit — so entries
          // accumulate here and every screen still sees one whole list.
          for (const entry of message.art) this.artByPlayer.set(entry.playerId, entry);
          this.handlers.onArt?.([...this.artByPlayer.values()]);
          break;
        case 'error':
          this.handlers.onError?.(message.reason);
          break;
        case 'closed':
          this.handlers.onClosed?.();
          break;
      }
    });

    this.socket.addEventListener('close', () => {
      announce(false);
      this.handlers.onClose?.();
    });
    this.socket.addEventListener('open', () => announce(true));
  }

  on(handlers: RoomHandlers): this {
    this.handlers = { ...this.handlers, ...handlers };
    return this;
  }

  /**
   * Sends a message, unless it would cost us the connection.
   *
   * The platform closes a socket that carries an oversized message rather than
   * rejecting the message, so an unchecked send does not fail — it disconnects
   * the player, silently, and whatever they were doing is lost. Refusing to
   * send is the lesser failure, and the caller is told.
   */
  send(message: ClientMessage): boolean {
    const encoded = JSON.stringify(message);
    if (encoded.length > MAX_MESSAGE_BYTES * 0.95) {
      console.warn(`[room] refusing to send ${message.type}: ${encoded.length} bytes`);
      return false;
    }
    this.socket.send(encoded);
    return true;
  }

  close(): void {
    this.socket.close();
  }
}
