import type * as Party from 'partykit/server';
import {
  CREATION_STEPS,
  MAX_PLAYERS,
  REVEAL_SECONDS,
  VOTE_SECONDS,
  battlegrounds,
  canStart,
  creators,
  drawBattleground,
  voters,
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
/** Stand-in names, per the brief's rule for anything left unnamed. */
const FALLBACK_WEAPONS = ['Sword', 'Axe', 'Hammer'];

function defaultName(slot: string): string {
  if (slot === 'character') return 'Nameless';
  const index = Number(slot.replace('weapon', ''));
  return FALLBACK_WEAPONS[index] ?? 'Weapon';
}

export default class Room implements Party.Server {
  private state: RoomState;

  constructor(readonly room: Party.Room) {
    this.state = {
      code: room.id,
      phase: 'lobby',
      capacity: 0,
      players: [],
      teamNames: { teamA: 'Team One', teamB: 'Team Two' },
      step: -1,
      stepEndsAt: 0,
      votes: {},
      chosen: null,
    };
  }

  /**
   * Finished artwork, kept out of the broadcast state.
   *
   * A character PNG runs to hundreds of kilobytes; sending every player's
   * artwork to every device on every state change would swamp a phone. Only
   * progress flags are broadcast, and the art is handed over when the battle
   * needs it.
   */
  private readonly art = new Map<string, string>();
  private readonly names = new Map<string, string>();
  /** Timer that ends the current creation step. */
  private stepTimer: ReturnType<typeof setTimeout> | null = null;

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
      case 'submitDrawing':
        this.onSubmitDrawing(message.slot, message.png, sender);
        break;
      case 'submitName':
        this.onSubmitName(message.slot, message.name, sender);
        break;
      case 'ready':
        this.onReady(sender);
        break;
      case 'voteBattleground':
        this.onVote(message.id, sender);
        break;
      case 'requestArt':
        this.onRequestArt(sender);
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
      progress: { drawn: [], named: [], ready: false },
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
      progress: { drawn: [], named: [], ready: false },
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
    this.state.phase = 'creating';
    this.beginStep(0);
  }

  // ------------------------------------------------------------------ creating

  /**
   * Starts a creation step and sets its deadline.
   *
   * The deadline is an absolute time rather than a duration, so a phone that
   * slept or joined late lands on the same instant as everyone else instead of
   * starting its own countdown.
   */
  private beginStep(index: number): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);

    const step = CREATION_STEPS[index];
    if (!step) {
      this.beginVote();
      return;
    }

    this.state.step = index;
    this.state.stepEndsAt = Date.now() + step.seconds * 1000;
    for (const player of this.state.players) player.progress.ready = false;

    this.stepTimer = setTimeout(() => this.beginStep(index + 1), step.seconds * 1000);
    this.broadcastState();
  }

  /** Moves on early once every creator has finished the current step. */
  private advanceIfAllReady(): void {
    const active = creators(this.state).filter((p) => p.connected);
    if (active.length === 0 || !active.every((p) => p.progress.ready)) return;
    this.beginStep(this.state.step + 1);
  }

  // -------------------------------------------------------------- battleground

  /** Opens the vote, on the same server-held clock the creation steps use. */
  private beginVote(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.state.phase = 'battleground';
    this.state.step = -1;
    this.state.votes = {};
    this.state.chosen = null;
    this.state.stepEndsAt = Date.now() + VOTE_SECONDS * 1000;
    this.stepTimer = setTimeout(() => this.closeVote(), VOTE_SECONDS * 1000);
    this.broadcastState();
  }

  private onVote(id: string, sender: Party.Connection): void {
    if (this.state.phase !== 'battleground' || this.state.chosen) return;
    const player = this.state.players.find((p) => p.id === sender.id && !p.isHost);
    if (!player) return;
    if (!battlegrounds.some((b) => b.id === id)) return;

    this.state.votes[player.id] = id;
    this.broadcastState();

    // Close as soon as everyone has picked; nobody should sit out the clock.
    const waiting = voters(this.state).filter((p) => p.connected && !this.state.votes[p.id]);
    if (waiting.length === 0) this.closeVote();
  }

  /**
   * Draws the ground and holds the result on screen before the battle.
   *
   * The pause is the point of the Mario Kart rule: the draw has to be seen to
   * be a draw, or it reads as the game ignoring the vote.
   */
  private closeVote(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    if (this.state.chosen) return;

    this.state.chosen = drawBattleground(
      this.state.votes,
      battlegrounds.map((b) => b.id),
    );
    this.state.stepEndsAt = Date.now() + REVEAL_SECONDS * 1000;
    this.broadcastState();

    this.stepTimer = setTimeout(() => {
      this.state.phase = 'battle';
      this.state.stepEndsAt = 0;
      this.broadcastState();
    }, REVEAL_SECONDS * 1000);
  }

  private onSubmitDrawing(slot: string, png: string, sender: Party.Connection): void {
    const player = this.state.players.find((p) => p.id === sender.id);
    if (!player || this.state.phase !== 'creating') return;
    if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,')) return;

    this.art.set(`${player.id}:${slot}`, png);
    if (!player.progress.drawn.includes(slot)) player.progress.drawn.push(slot);
    player.progress.ready = true;
    this.broadcastState();
    this.advanceIfAllReady();
  }

  private onSubmitName(slot: string, name: string, sender: Party.Connection): void {
    const player = this.state.players.find((p) => p.id === sender.id);
    if (!player || this.state.phase !== 'creating') return;

    // A blank name still counts: the brief says everything must be named, and
    // a player who runs out of time should not stall the whole room.
    const clean = (typeof name === 'string' ? name : '').trim().slice(0, 24) || defaultName(slot);
    this.names.set(`${player.id}:${slot}`, clean);
    if (!player.progress.named.includes(slot)) player.progress.named.push(slot);
    player.progress.ready = true;
    this.broadcastState();
    this.advanceIfAllReady();
  }

  private onReady(sender: Party.Connection): void {
    const player = this.state.players.find((p) => p.id === sender.id);
    if (!player) return;
    player.progress.ready = true;
    this.broadcastState();
    this.advanceIfAllReady();
  }

  // --------------------------------------------------------------------- utils

  private isHost(connection: Party.Connection): boolean {
    return this.state.players.some((p) => p.id === connection.id && p.isHost);
  }

  private send(connection: Party.Connection, message: ServerMessage): void {
    connection.send(JSON.stringify(message));
  }

  /**
   * Hands the artwork over, to the host only.
   *
   * Sent on request rather than broadcast: this is megabytes of PNG, and only
   * the shared screen draws with it. Phones never need it and would pay for it
   * in memory and bandwidth.
   */
  private onRequestArt(sender: Party.Connection): void {
    if (!this.isHost(sender)) return;

    const art = creators(this.state).map((player) => {
      const pieces = this.creationsFor(player.id);
      const character = pieces.find((p) => p.slot === 'character');
      const weapons = pieces
        .filter((p) => p.slot.startsWith('weapon'))
        .sort((a, b) => a.slot.localeCompare(b.slot))
        .map((w) => ({ png: w.png, name: w.name }));
      return {
        playerId: player.id,
        character: character ? { png: character.png, name: character.name } : null,
        weapons,
      };
    });

    this.send(sender, { type: 'art', art });
  }

  /** Everything one player made, for the battle to draw with. */
  creationsFor(playerId: string): { slot: string; png: string; name: string }[] {
    const out: { slot: string; png: string; name: string }[] = [];
    for (const [key, png] of this.art) {
      const [owner, slot] = key.split(':');
      if (owner !== playerId || !slot) continue;
      out.push({ slot, png, name: this.names.get(key) ?? defaultName(slot) });
    }
    return out;
  }

  private broadcastState(): void {
    this.room.broadcast(JSON.stringify({ type: 'state', state: this.state } satisfies ServerMessage));
  }
}
