import PartySocket from 'partysocket';
import type {
  ClientMessage, PlayerArt, RoomState, ServerMessage,
} from '../shared/protocol';

/**
 * Client-side room connection.
 *
 * Wraps PartySocket so screens deal in typed messages and a state callback
 * rather than raw sockets. The server is authoritative: this never mutates
 * state locally, it only forwards intents and renders what comes back.
 */

const PARTY_HOST = import.meta.env['VITE_PARTYKIT_HOST'] ?? 'localhost:1999';

export interface RoomHandlers {
  onArt?: (art: PlayerArt[]) => void;
  onState?: (state: RoomState) => void;
  onWelcome?: (playerId: string, state: RoomState) => void;
  onError?: (reason: string) => void;
  onClose?: () => void;
}

export class RoomConnection {
  private readonly socket: PartySocket;
  private handlers: RoomHandlers = {};

  /** Assigned by the server on welcome; identifies this client's player. */
  playerId: string | null = null;
  state: RoomState | null = null;

  constructor(code: string) {
    this.socket = new PartySocket({ host: PARTY_HOST, room: code.toUpperCase() });

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
          this.handlers.onArt?.(message.art);
          break;
        case 'error':
          this.handlers.onError?.(message.reason);
          break;
      }
    });

    this.socket.addEventListener('close', () => this.handlers.onClose?.());
  }

  on(handlers: RoomHandlers): this {
    this.handlers = { ...this.handlers, ...handlers };
    return this;
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }
}
