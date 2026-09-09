import type * as Party from 'partykit/server';
import { handleApi } from '../server/api';
import {
  MAX_PHOTO_BYTES,
  MAX_PLAYERS,
  MAX_ULTS,
  WEAPON_COUNT,
  JUDGE_SECONDS,
  MOVE_SECONDS,
  REVEAL_SECONDS,
  ROUNDS_EACH,
  STARTING_HEALTH,
  VOTE_SECONDS,
  MAX_SCORE,
  availableFighters,
  averageScore,
  judges,
  trimPrompt,
  battlegrounds,
  canStart,
  creators,
  drawBattleground,
  stepsFor,
  voters,
  winningTeam,
  type ClientMessage,
  type Player,
  type PlayerArt,
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

/**
 * Artwork for anything nobody drew.
 *
 * Paths rather than data URLs: the host loads them straight from its own
 * origin, which costs nothing to broadcast and nothing to store.
 */
const FALLBACK_WEAPON_ART = [
  '/placeholder-weapon-sword.png',
  '/placeholder-weapon-axe.png',
  '/placeholder-weapon-hammer.png',
];
const FALLBACK_CHARACTER_ART = [
  '/placeholder-character-a.png',
  '/placeholder-character-b.png',
];

/**
 * What a bot writes when it is playing someone's turn for them.
 *
 * Deliberately short and physical: these go through the same choreographer as
 * a real player's fifty words, and a vague sentence animates as a shrug.
 */
const BOT_MOVES = [
  'charge in and swing it overhead as hard as possible',
  'spin on the spot and let it fly at them',
  'leap up and slam it straight down',
  'poke them with it repeatedly, very fast',
  'throw it, then panic and run away',
  'sweep their legs out from under them',
  'wind up a huge uppercut and connect',
  'hurl it like a javelin and dive after it',
];

const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)]!;

/** What the bot plays on behalf of a player who is not there. */
function botMove(player: Player): { weapon: number; prompt: string } {
  return {
    weapon: Math.floor(Math.random() * Math.max(1, player.weaponNames.length)),
    prompt: pick(BOT_MOVES),
  };
}

function defaultName(slot: string): string {
  if (slot === 'character') return 'Nameless';
  const index = Number(slot.replace('weapon', ''));
  // Anything past the three made in creation is an ULT, and naming it 'ULT'
  // reads better on a weapon button than a fourth stand-in noun would.
  return FALLBACK_WEAPONS[index] ?? 'ULT';
}

export default class Room implements Party.Server {
  /**
   * The API, for anything that is not a room.
   *
   * In development the browser talks to an Express server through Vite's
   * proxy; in production this worker serves the site itself, so the same
   * `/api` paths have to land somewhere. They land here, running the very same
   * handler — the key lives in the worker's environment and never in a bundle.
   *
   * `onFetch` only sees requests that match neither a party nor a static
   * asset, so returning null hands anything else back to the static site.
   */
  static async onFetch(
    request: Party.Request, lobby: Party.FetchLobby,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return null;

    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return Response.json({ error: 'expected JSON' }, { status: 400 });
      }
    }

    try {
      const result = await handleApi(url.pathname, body, lobby.env);
      if (!result) return Response.json({ error: 'no such endpoint' }, { status: 404 });
      return Response.json(result.body, { status: result.status });
    } catch (error) {
      console.error('[api]', error);
      return Response.json({ error: 'request failed' }, { status: 500 });
    }
  }

  private state: RoomState;

  constructor(readonly room: Party.Room) {
    this.state = {
      code: room.id,
      phase: 'lobby',
      capacity: 0,
      players: [],
      teamNames: { teamA: 'Team One', teamB: 'Team Two' },
      step: -1,
      ultRound: 0,
      stepEndsAt: 0,
      votes: {},
      chosen: null,
      turn: null,
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
  /** Turns fought in this room, so every turn has an identity of its own. */
  private turnCount = 0;

  onConnect(connection: Party.Connection): void {
    // A returning phone keeps its socket id across a reconnect, so a locked
    // screen or a walk out of wifi range comes back to the same seat and the
    // bot hands their fighter straight back.
    const player = this.state.players.find((p) => p.id === connection.id);
    if (player && !player.connected) {
      player.connected = true;
      this.broadcastState();
    }

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
        this.beginGame(sender);
        break;
      case 'submitDrawing':
        this.onSubmitDrawing(message.slot, message.png, message.done === true, sender);
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
      case 'submitMove':
        this.onSubmitMove(message.weapon, message.prompt, sender);
        break;
      case 'turnPlayed':
        // Only the host knows when the animation has finished playing.
        if (this.isHost(sender)) this.openJudging();
        break;
      case 'submitScore':
        this.onScore(message.attackerId, message.score, sender);
        break;
      case 'submitNote':
        if (this.isHost(sender)) this.onNote(message.attackerId, message.note);
        break;
      case 'turnDone':
        if (this.isHost(sender)) this.endTurn();
        break;
      case 'rematch':
        // Same characters, same weapons, a fresh battleground vote — which is
        // where the brief's rematch button leads.
        if (this.isHost(sender)) this.beginVote();
        break;
      case 'newGame':
        if (this.isHost(sender)) this.startOver();
        break;
      case 'closeRoom':
        if (this.isHost(sender)) this.closeRoom();
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
    // If they walked out mid-turn, the bot picks up their move now rather than
    // holding the fight open for a minute of nothing.
    this.playBots();
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
      health: STARTING_HEALTH,
      fights: 0,
      characterName: '',
      weaponNames: [],
      damageDealt: 0,
      damageTaken: 0,
      best: null,
    };
    this.state.players.push(host);
    this.send(sender, { type: 'welcome', playerId: sender.id, state: this.state });
    this.broadcastState();
  }

  private onJoin(name: string, photo: string | undefined, sender: Party.Connection): void {
    const existing = this.state.players.find((p) => p.id === sender.id);
    if (existing) {
      existing.connected = true;
      this.send(sender, { type: 'welcome', playerId: existing.id, state: this.state });
      this.broadcastState();
      return;
    }

    if (this.state.phase !== 'lobby') {
      this.send(sender, { type: 'error', reason: 'That game has already started.' });
      return;
    }

    // Every four-letter code is a room the platform will happily create, so a
    // typo does not fail — it opens an empty room and leaves the player
    // waiting in it for people who are elsewhere. A room without a host is not
    // a room anyone meant to join.
    if (!this.state.players.some((p) => p.isHost)) {
      this.send(sender, {
        type: 'error',
        reason: 'No game with that code. Check the letters on the big screen.',
      });
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

    // A photo that arrives too large is dropped rather than stored: it would
    // be rebroadcast inside every state update from here to the end of the
    // game, and the first one over the limit would close everyone's socket.
    const avatar = typeof photo === 'string' && photo.length <= MAX_PHOTO_BYTES * 1.4
      ? photo
      : undefined;

    this.state.players.push({
      id: sender.id,
      name: unique,
      ...(avatar ? { photo: avatar } : {}),
      role: 'unassigned',
      connected: true,
      isHost: false,
      progress: { drawn: [], named: [], ready: false },
      health: STARTING_HEALTH,
      fights: 0,
      characterName: '',
      weaponNames: [],
      damageDealt: 0,
      damageTaken: 0,
      best: null,
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

  /**
   * Named `beginGame`, not `onStart`: PartyKit's own `Server.onStart` is the
   * lifecycle hook it calls with no arguments when a room boots. A handler of
   * that name here was being invoked by the runtime as well as by the host's
   * Start button, with an undefined connection.
   */
  private beginGame(sender: Party.Connection): void {
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

    const step = stepsFor(this.state)[index];
    if (!step) {
      // Creation leads to the battleground vote; an ULT leads straight back
      // onto the ground already chosen — the tie is what is being settled,
      // not the venue.
      if (this.state.phase === 'ult') this.beginSuddenDeath();
      else this.beginVote();
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
    // Guarded on the phase because `ready` survives into the battle, and a
    // stray `ready` message there must not walk the step counter forward.
    if (!this.isCreating()) return;
    const active = creators(this.state).filter((p) => p.connected);
    if (active.length === 0 || !active.every((p) => p.progress.ready)) return;
    this.beginStep(this.state.step + 1);
  }

  // -------------------------------------------------------------- battleground

  /**
   * Gives every creator a full set of artwork and names.
   *
   * A player whose phone died mid-draw keeps whatever they had last submitted,
   * per the brief; anything they never got to becomes the stand-in Sword, Axe
   * or Hammer. Without this a dropped player has no character texture at all,
   * and the battle screen simply skips them — the fight would be one-sided
   * with no explanation.
   */
  private fillCreations(): void {
    for (const [index, player] of creators(this.state).entries()) {
      const slots = ['character', ...this.weaponSlots()];
      for (const slot of slots) {
        const key = `${player.id}:${slot}`;
        if (!this.art.has(key)) {
          this.art.set(key, slot === 'character'
            ? FALLBACK_CHARACTER_ART[index % FALLBACK_CHARACTER_ART.length]!
            : FALLBACK_WEAPON_ART[
                Number(slot.replace('weapon', '')) % FALLBACK_WEAPON_ART.length
              ]!);
          if (!player.progress.drawn.includes(slot)) player.progress.drawn.push(slot);
        }
        if (!this.names.has(key)) {
          const name = defaultName(slot);
          this.names.set(key, name);
          if (slot === 'character') player.characterName ||= name;
          else player.weaponNames[Number(slot.replace('weapon', ''))] ||= name;
          if (!player.progress.named.includes(slot)) player.progress.named.push(slot);
        }
      }
    }
  }

  /** Every weapon slot that exists so far, ULTs included. */
  private weaponSlots(): string[] {
    const count = WEAPON_COUNT + this.state.ultRound;
    return Array.from({ length: count }, (_, i) => `weapon${i}`);
  }

  /** Opens the vote, on the same server-held clock the creation steps use. */
  private beginVote(): void {
    this.fillCreations();
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

    this.stepTimer = setTimeout(() => this.beginBattle(), REVEAL_SECONDS * 1000);
  }

  // --------------------------------------------------------------------- battle

  private beginBattle(): void {
    this.state.phase = 'battle';
    for (const player of this.state.players) {
      player.health = STARTING_HEALTH;
      player.fights = 0;
    }
    this.beginTurn();
  }

  /**
   * Brings a fighter on from each side.
   *
   * Chosen at random among those still standing and still owed rounds, which
   * is the brief's tag-team rule; in a 1v1 there is only ever one candidate,
   * so the same code covers both.
   */
  private beginTurn(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);

    const left = availableFighters(this.state, 'teamA');
    const right = availableFighters(this.state, 'teamB');

    // A side with nobody left to fight ends the battle.
    if (left.length === 0 || right.length === 0) {
      this.endBattle();
      return;
    }

    const a = left[Math.floor(Math.random() * left.length)]!;
    const b = right[Math.floor(Math.random() * right.length)]!;

    this.state.turn = {
      index: this.turnCount += 1,
      fighters: [a.id, b.id],
      moves: {},
      judged: {},
      damage: {},
      notes: {},
      first: null,
      phase: 'picking',
    };
    this.state.stepEndsAt = Date.now() + MOVE_SECONDS * 1000;
    this.stepTimer = setTimeout(() => this.closeMoves(), MOVE_SECONDS * 1000);
    this.broadcastState();
    this.playBots();
  }

  /**
   * Writes for any fighter on stage who is not there to write for themselves.
   *
   * Immediately, rather than on the move clock: a bot that waited out the full
   * minute would leave the player opposite staring at an empty stage for it,
   * which is the same as no bot at all.
   */
  private playBots(): void {
    const turn = this.state.turn;
    if (!turn || turn.phase !== 'picking') return;

    let wrote = false;
    for (const id of turn.fighters) {
      if (turn.moves[id]) continue;
      const player = this.state.players.find((p) => p.id === id);
      if (!player || player.connected) continue;
      turn.moves[id] = botMove(player);
      wrote = true;
    }
    if (!wrote) return;

    this.broadcastState();
    if (turn.fighters.every((id) => turn.moves[id])) this.closeMoves();
  }

  /**
   * The fight is over: either someone won on damage taken, or nobody did.
   *
   * A level score sends both sides back to draw one more weapon, which is the
   * brief's ULT. It is capped so an evenly matched pair of teams eventually
   * gets an answer — a declared tie — rather than an endless creation loop.
   */
  private endBattle(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.state.turn = null;
    this.state.stepEndsAt = 0;

    if (winningTeam(this.state) === null && this.state.ultRound < MAX_ULTS) {
      this.beginUlt();
      return;
    }

    this.state.phase = 'results';
    this.broadcastState();
  }

  /**
   * A whole new game: new characters, new weapons, everyone back to drawing.
   *
   * Distinct from a rematch, which keeps what people made. Everything a player
   * built is dropped, because otherwise the creation steps would open with the
   * last game's drawings sitting behind them.
   */
  private startOver(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.art.clear();
    this.names.clear();
    this.turnCount = 0;
    this.state.ultRound = 0;
    this.state.turn = null;
    this.state.votes = {};
    this.state.chosen = null;

    for (const player of this.state.players) {
      player.progress = { drawn: [], named: [], ready: false };
      player.health = STARTING_HEALTH;
      player.fights = 0;
      player.characterName = '';
      player.weaponNames = [];
      player.damageDealt = 0;
      player.damageTaken = 0;
      player.best = null;
    }

    this.state.phase = 'creating';
    this.beginStep(0);
  }

  /** Shuts the room: every device goes back to its own menu. */
  private closeRoom(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.room.broadcast(JSON.stringify({ type: 'closed' } satisfies ServerMessage));
  }

  /** Sends everyone back to the drawing board for one more weapon. */
  private beginUlt(): void {
    this.state.phase = 'ult';
    this.state.ultRound += 1;
    for (const player of this.state.players) player.progress.ready = false;
    this.beginStep(0);
  }

  /**
   * One more fight each, with the ULT in hand.
   *
   * Health is restored so a knocked-out fighter can still swing their ULT —
   * the tie is being settled on total damage taken, and sitting a player out
   * of the round that decides it would be a strange way to break it.
   */
  private beginSuddenDeath(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.fillCreations();
    this.state.phase = 'battle';
    for (const player of this.state.players) {
      player.health = STARTING_HEALTH;
      player.fights = Math.max(0, ROUNDS_EACH - 1);
    }
    this.beginTurn();
  }

  /** True while players are making things, in creation or in an ULT. */
  private isCreating(): boolean {
    return this.state.phase === 'creating' || this.state.phase === 'ult';
  }

  private onSubmitMove(weapon: number, prompt: string, sender: Party.Connection): void {
    const turn = this.state.turn;
    if (!turn || turn.phase !== 'picking') return;
    if (!turn.fighters.includes(sender.id)) return;

    turn.moves[sender.id] = {
      weapon: Math.max(0, Math.min(2, Math.floor(weapon) || 0)),
      prompt: trimPrompt(prompt),
    };
    this.broadcastState();

    if (turn.fighters.every((id) => turn.moves[id])) this.closeMoves();
  }

  /**
   * Locks the moves in and draws who strikes first.
   *
   * Drawn only once both are in, so submitting early buys nothing — a player
   * who could win the first strike by being quick would be racing rather than
   * writing.
   */
  private closeMoves(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    const turn = this.state.turn;
    if (!turn || turn.phase !== 'picking') return;

    // Anyone who wrote nothing still fights; the brief says an unusable
    // request just swings the weapon like an axe.
    //
    // A player whose phone has dropped gets more than that: a bot takes their
    // turn, because a disconnected fighter standing still for three rounds is
    // no fun for the person across from them.
    for (const id of turn.fighters) {
      if (turn.moves[id]) continue;
      const player = this.state.players.find((p) => p.id === id);
      turn.moves[id] = player && !player.connected
        ? botMove(player)
        : { weapon: 0, prompt: '' };
    }

    turn.first = turn.fighters[Math.floor(Math.random() * 2)]!;
    turn.phase = 'playing';
    this.state.stepEndsAt = 0;
    this.broadcastState();
  }

  // -------------------------------------------------------------------- judging

  /**
   * Opens judging once the exchange has played.
   *
   * With judges in the room they score on their phones; in a two-player game
   * there are none, and the host submits the AI's scores through the same
   * path — so the averaging and damage rules have only one implementation.
   */
  private openJudging(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    const turn = this.state.turn;
    if (!turn || turn.phase !== 'playing') return;

    turn.phase = 'judging';
    this.state.stepEndsAt = Date.now() + JUDGE_SECONDS * 1000;
    this.stepTimer = setTimeout(() => this.closeJudging(), JUDGE_SECONDS * 1000);
    this.broadcastState();
  }

  private onScore(attackerId: string, score: number, sender: Party.Connection): void {
    const turn = this.state.turn;
    if (!turn || turn.phase !== 'judging') return;
    if (!turn.fighters.includes(attackerId)) return;

    // A judge scores as themselves; the host stands in for the AI when there
    // are no judges, and must not be able to score a game that has them.
    const isJudge = judges(this.state).some((p) => p.id === sender.id);
    // The AI stands in when there are no judges *present* — a judge whose
    // phone has locked must not be able to stall the round from the sofa.
    const isAiJudge = this.isHost(sender) && this.activeJudges().length === 0;
    if (!isJudge && !isAiJudge) return;

    const clean = Math.max(0, Math.min(MAX_SCORE, Math.round(Number(score) || 0)));
    (turn.judged[sender.id] ??= {})[attackerId] = clean;
    this.broadcastState();

    // Close as soon as every scorer has rated both fighters.
    const scorers = isAiJudge ? [sender.id] : this.activeJudges().map((p) => p.id);
    const complete = scorers.length > 0 && scorers.every(
      (id) => turn.fighters.every((f) => typeof turn.judged[id]?.[f] === 'number'),
    );
    if (complete) this.closeJudging();
  }

  private onNote(attackerId: string, note: string): void {
    const turn = this.state.turn;
    if (!turn) return;
    turn.notes[attackerId] = String(note ?? '').slice(0, 80);
    this.broadcastState();
  }

  /**
   * Averages the scores and takes the damage off.
   *
   * A move's score is damage dealt to the OTHER fighter, which is what makes
   * "least damage taken wins" mean anything.
   */
  private closeJudging(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    const turn = this.state.turn;
    if (!turn || turn.phase !== 'judging') return;

    for (const attackerId of turn.fighters) {
      const dealt = averageScore(turn, attackerId);
      turn.damage[attackerId] = dealt;

      const attacker = this.state.players.find((p) => p.id === attackerId);
      const defenderId = turn.fighters.find((id) => id !== attackerId);
      const defender = this.state.players.find((p) => p.id === defenderId);

      if (defender) {
        defender.health = Math.max(0, defender.health - dealt);
        defender.damageTaken += dealt;
      }
      if (attacker) {
        attacker.damageDealt += dealt;
        // Ties keep the earlier hit; the brief says pick any of them, and the
        // first is as good a choice as a random one and easier to reason about.
        if (!attacker.best || dealt > attacker.best.damage) {
          const move = turn.moves[attackerId];
          attacker.best = {
            weapon: attacker.weaponNames[move?.weapon ?? 0] || 'their weapon',
            prompt: move?.prompt ?? '',
            damage: dealt,
          };
        }
      }
    }

    turn.phase = 'over';
    this.state.stepEndsAt = 0;
    this.broadcastState();
  }

  /** The host reports a finished exchange; the next turn is set up. */
  private endTurn(): void {
    const turn = this.state.turn;
    if (!turn) return;
    for (const id of turn.fighters) {
      const player = this.state.players.find((p) => p.id === id);
      if (player) player.fights += 1;
    }
    this.beginTurn();
  }

  /**
   * Stores a drawing. Only an explicit `done` ends the player's step.
   *
   * The tool autosaves while a player draws, so that work survives a dead
   * phone or a timer running out. Treating those saves as "finished" would
   * end the step the moment everyone had drawn a single line.
   */
  private onSubmitDrawing(
    slot: string, png: string, done: boolean, sender: Party.Connection,
  ): void {
    const player = this.state.players.find((p) => p.id === sender.id);
    if (!player || !this.isCreating()) return;
    if (typeof png !== 'string' || !png.startsWith('data:image/png;base64,')) return;

    this.art.set(`${player.id}:${slot}`, png);
    if (!player.progress.drawn.includes(slot)) player.progress.drawn.push(slot);
    if (done) player.progress.ready = true;
    this.broadcastState();
    if (done) this.advanceIfAllReady();
  }

  private onSubmitName(slot: string, name: string, sender: Party.Connection): void {
    const player = this.state.players.find((p) => p.id === sender.id);
    if (!player || !this.isCreating()) return;

    // A blank name still counts: the brief says everything must be named, and
    // a player who runs out of time should not stall the whole room.
    const clean = (typeof name === 'string' ? name : '').trim().slice(0, 24) || defaultName(slot);
    this.names.set(`${player.id}:${slot}`, clean);

    // Mirrored onto the player so every screen has them without asking.
    if (slot === 'character') player.characterName = clean;
    else {
      const index = Number(slot.replace('weapon', ''));
      if (Number.isInteger(index)) player.weaponNames[index] = clean;
    }

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

  private isHost(connection: Party.Connection | undefined): boolean {
    if (!connection) return false;
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
  /**
   * Hands over finished artwork.
   *
   * The host gets everyone's, because it draws the fight. A player gets their
   * own and nobody else's: their phone needs it to show which weapon is which
   * when they pick one, and there is no reason for one player's drawings to
   * sit in another player's memory.
   */
  private onRequestArt(sender: Party.Connection): void {
    if (!this.isHost(sender)) {
      const player = this.state.players.find((p) => p.id === sender.id && !p.isHost);
      if (player) this.send(sender, { type: 'art', art: [this.artFor(player.id)] });
      return;
    }

    // One message per player. Six characters and eighteen weapons together run
    // to several megabytes, and the platform closes a socket that carries a
    // message over a megabyte — which would take the host's screen down at the
    // exact moment the battle starts.
    for (const player of creators(this.state)) {
      this.send(sender, { type: 'art', art: [this.artFor(player.id)] });
    }
  }

  /** One player's finished work, in the shape the wire carries. */
  private artFor(playerId: string): PlayerArt {
    const pieces = this.creationsFor(playerId);
    const character = pieces.find((p) => p.slot === 'character');
    return {
      playerId,
      character: character ? { png: character.png, name: character.name } : null,
      weapons: pieces
        .filter((p) => p.slot.startsWith('weapon'))
        .sort((a, b) => a.slot.localeCompare(b.slot))
        .map((w) => ({ png: w.png, name: w.name })),
    };
  }

  /** The judges actually holding a phone right now. */
  private activeJudges(): Player[] {
    return judges(this.state).filter((p) => p.connected);
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

// Type-checks the static hooks above — `implements` cannot see them, so
// without this an `onFetch` with the wrong shape would compile and then simply
// never be called.
Room satisfies Party.Worker;
