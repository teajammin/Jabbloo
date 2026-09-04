import type * as Party from 'partykit/server';
import {
  MAX_PLAYERS,
  canStart,
  type ClientMessage,
  type Player,
  type Role,
  type RoomState,
  type ServerMessage,
} from '../src/shared/protocol';

/**
 * One Jabbloo room.
 *
 * PartyKit gives each room code its own server instance, so this class only
 * ever manages a single game. The room ID *is* the join code.
 *
 * The server owns the state. Clients send intents and render whatever comes
 * back — never their own optimistic copy — so the host screen and every phone
 * always agree on who is in the room and what phase it is in.
 */
export default class Room implements Party.Server {
  private state: RoomState;

  constructor(readonly room: Party.Room) {
    this.state = {
      code: room.id,
      phase: 'lobby',
      capacity: 0,
      players: [],
      teamNames: { teamA: 'Team One', teamB: 'Team Two' },
    };
  }

  onConnect(connection: Party.Connection): void {
    // A connection is not yet a player: the host and joining phones both
    // connect first, then declare themselves with `host` or `join`.
    this.send(connection, { type: 'state', state: this.state });
  }

  onMessage(raw: string, sender: Party.Connection): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(sender, { type: 'error', reason: 'Malformed message' });
      return;
    }

    switch (message.type) {
      case 'host':
        this.onHost(message.capacity, sender);
        break;
      case 'join':
        this.onJoin(message.name, message.photo, sender);
        break;
      case 'setRole':
        this.onSetRole(message.playerId, message.role, sender);
        break;
      case 'setTeamName':
        this.onSetTeamName(message.team, message.name, sender);
        break;
      case 'start':
        this.onStart(sender);
        break;
      default:
        this.send(sender, { type: 'error', reason: 'Unknown message' });
    }
  }

  onClose(connection: Party.Connection): void {
    const player = this.state.players.find((p) => p.id === connection.id);
    if (!player) return;

    if (this.state.phase === 'lobby') {
      // Nothing has been created yet, so drop them entirely.
      this.state.players = this.state.players.filter((p) => p.id !== connection.id);
    } else {
      // Mid-game, keep the seat: the brief calls for a bot to take over, and
      // the player's drawings must survive their phone locking.
      player.connected = false;
    }
    this.broadcastState();
  }

  // ------------------------------------------------------------------ handlers

  private onHost(capacity: number, sender: Party.Connection): void {
    if (this.state.players.some((p) => p.isHost)) {
      this.send(sender, { type: 'error', reason: 'This room already has a host' });
      return;
    }

    this.state.capacity = Math.max(2, Math.min(MAX_PLAYERS, Math.floor(capacity) || 2));
    const host: Player = {
      id: sender.id,
      name: 'Host',
      role: 'unassigned',
      connected: true,
      isHost: true,
    };
    this.state.players.push(host);
    this.send(sender, { type: 'welcome', playerId: sender.id, state: this.state });
    this.broadcastState();
  }

  private onJoin(name: string, photo: string | undefined, sender: Party.Connection): void {
    const existing = this.state.players.find((p) => p.id === sender.id);
    if (existing) {
      this.send(sender, { type: 'welcome', playerId: existing.id, state: this.state });
      return;
    }

    if (this.state.phase !== 'lobby') {
      this.send(sender, { type: 'error', reason: 'That game has already started' });
      return;
    }

    const players = this.state.players.filter((p) => !p.isHost);
    if (players.length >= MAX_PLAYERS) {
      this.send(sender, { type: 'error', reason: 'This room is full' });
      return;
    }

    const clean = name.trim().slice(0, 16) || `Player ${players.length + 1}`;
    const taken = new Set(players.map((p) => p.name.toLowerCase()));
    let unique = clean;
    let suffix = 2;
    while (taken.has(unique.toLowerCase())) unique = `${clean} ${suffix++}`;

    this.state.players.push({
      id: sender.id,
      name: unique,
      ...(photo ? { photo } : {}),
      role: 'unassigned',
      connected: true,
      isHost: false,
    });

    this.send(sender, { type: 'welcome', playerId: sender.id, state: this.state });
    this.broadcastState();
  }

  private onSetRole(playerId: string, role: Role, sender: Party.Connection): void {
    // Per the brief, only the host arranges teams — and only from the laptop.
    if (!this.isHost(sender)) {
      this.send(sender, { type: 'error', reason: 'Only the host can assign teams' });
      return;
    }
    const player = this.state.players.find((p) => p.id === playerId && !p.isHost);
    if (!player) return;
    player.role = role;
    this.broadcastState();
  }

  private onSetTeamName(team: 'teamA' | 'teamB', name: string, sender: Party.Connection): void {
    if (!this.isHost(sender)) return;
    const clean = name.trim().slice(0, 18);
    if (clean) this.state.teamNames[team] = clean;
    this.broadcastState();
  }

  private onStart(sender: Party.Connection): void {
    if (!this.isHost(sender)) return;
    if (!canStart(this.state)) {
      this.send(sender, { type: 'error', reason: 'Not everyone has a place yet' });
      return;
    }
    this.state.phase = 'characters';
    this.broadcastState();
  }

  // --------------------------------------------------------------------- utils

  private isHost(connection: Party.Connection): boolean {
    return this.state.players.some((p) => p.id === connection.id && p.isHost);
  }

  private send(connection: Party.Connection, message: ServerMessage): void {
    connection.send(JSON.stringify(message));
  }

  private broadcastState(): void {
    this.room.broadcast(JSON.stringify({ type: 'state', state: this.state } satisfies ServerMessage));
  }
}
