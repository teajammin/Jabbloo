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
  isFinalRound,
  FINAL_ROUND_MULTIPLIER,
  judges,
  trimPrompt,
  battlegrounds,
  canStart,
  creators,
  drawBattleground,
  GRACE_SECONDS,
  graceExpired,
  isDuel,
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
  // Anything past the three made in creation is an Ultimate, and naming it
  // so reads better on a weapon button than a fourth stand-in noun would.
  return FALLBACK_WEAPONS[index] ?? 'Ultimate';
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

    /*
     * The room itself decides whether a call may spend money: the worker asks
     * the party named in the request whether that device is the screen running
     * a fight right now. A stranger with the URL has no room to name.
     */
    const vouch = async (roomId: string, device: string): Promise<boolean> => {
      try {
        const party = lobby.parties['main']?.get(roomId.toUpperCase());
        if (!party) return false;
        const answer = await party.fetch(
          `https://party/?device=${encodeURIComponent(device)}`,
        );
        if (!answer.ok) return false;
        const { ok } = await answer.json() as { ok?: boolean };
        return ok === true;
      } catch {
        return false;
      }
    };

    try {
      const result = await handleApi(url.pathname, body, lobby.env, vouch);
      if (!result) return Response.json({ error: 'no such endpoint' }, { status: 404 });
      return Response.json(result.body, { status: result.status });
    } catch (error) {
      console.error('[api]', error);
      return Response.json({ error: 'request failed' }, { status: 500 });
    }
  }

  /**
   * Answers whether a caller belongs to a fight in progress.
   *
   * The AI endpoints cost money on every call, and they sit on a public URL.
   * Rather than guard them with a secret the browser would have to hold, the
   * worker asks the room: only the screen running a fight that has reached the
   * playing or judging stage has any business asking for choreography.
   */
  onRequest(request: Party.Request): Response {
    const id = new URL(request.url).searchParams.get('device') ?? '';
    const turn = this.state.turn;
    const host = this.state.players.find((p) => p.isHost);

    const fighting = this.state.phase === 'battle'
      && turn !== null
      && (turn.phase === 'playing' || turn.phase === 'judging');

    return Response.json({
      ok: fighting && host?.id === id && host.connected,
    });
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
  /** Ticks while people are creating, watching each player's own deadline. */
  private creationClock: ReturnType<typeof setInterval> | null = null;
  /** Ticks while anybody is away, waiting out their grace period. */
  private graceClock: ReturnType<typeof setInterval> | null = null;
  /** Turns fought in this room, so every turn has an identity of its own. */
  private turnCount = 0;

  onConnect(connection: Party.Connection): void {
    // A returning phone keeps its socket id across a reconnect, so a locked
    // screen or a walk out of wifi range comes back to the same seat and the
    // bot hands their fighter straight back.
    const player = this.state.players.find((p) => p.id === connection.id);
    if (player && !player.connected) {
      this.welcomeBack(player);

      // Back before the room moved on: they pick up where they left off, with
      // a full step's time rather than the seconds that were left when their
      // phone died.
      const steps = stepsFor(this.state);
      if (this.isCreating() && player.progress.done
        && player.progress.step < steps.length) {
        player.progress.done = false;
        player.progress.endsAt = Date.now()
          + (steps[player.progress.step]?.seconds ?? 30) * 1000;
        this.summariseDeadline();
      }

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
      case 'leave':
        this.onLeave(sender);
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

  /**
   * A device has gone quiet. Nobody is written off for that alone.
   *
   * Removing people on disconnect was wrong in every phase, and worst in the
   * lobby, where it removed the host too: one blip on the host's connection
   * emptied the room of its host, and the next thing any player's client said
   * was answered with "no game with that code". A phone locking, a tab going
   * to the background and a person leaving all look identical here. Only time
   * tells them apart, so the room waits.
   */
  onClose(connection: Party.Connection): void {
    const player = this.state.players.find((p) => p.id === connection.id);
    if (!player) return;

    player.connected = false;
    player.leftAt = Date.now();
    this.startGraceClock();
    this.broadcastState();
    // If they walked out mid-turn, the bot picks up their move now rather than
    // holding the fight open for a minute of nothing.
    this.playBots();
  }

  // ------------------------------------------------------------------ handlers

  private onHost(capacity: number, sender: Party.Connection): void {
    const existing = this.state.players.find((p) => p.isHost);

    if (existing) {
      /*
       * The screen coming back, or a new one taking over.
       *
       * A host whose tab reloads mid-game used to be told the room already had
       * a host — by itself — and the game became unrecoverable: no screen to
       * run the fight, and players left waiting in a room nobody was driving.
       *
       * The same device always reclaims the seat. A different one may only
       * take it when the old screen has actually gone, so a stray tab cannot
       * steal a running game.
       */
      if (existing.id === sender.id || !existing.connected) {
        existing.id = sender.id;
        this.welcomeBack(existing);
        this.send(sender, { type: 'welcome', playerId: sender.id, state: this.state });
        this.broadcastState();
        return;
      }

      this.send(sender, {
        type: 'error',
        reason: 'This room already has a host screen.',
      });
      return;
    }

    this.state.capacity = Math.max(2, Math.min(MAX_PLAYERS, Math.floor(capacity) || 2));
    const host: Player = {
      id: sender.id,
      name: 'Host',
      role: 'unassigned',
      connected: true,
      isHost: true,
      leftAt: 0,
      progress: { drawn: [], named: [], step: 0, endsAt: 0, done: false },
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
    // Tidied once, at the top, because both the rejoin path and the new-player
    // path need it — and a `const` read from inside a closure before its own
    // declaration is a runtime error the compiler cannot see.
    const wanted = name.trim().slice(0, 16);

    const existing = this.state.players.find((p) => p.id === sender.id);
    if (existing) {
      this.welcomeBack(existing);
      this.send(sender, { type: 'welcome', playerId: existing.id, state: this.state });
      this.broadcastState();
      return;
    }

    if (this.state.phase !== 'lobby') {
      /*
       * Coming back after closing the tab.
       *
       * A device that merely locked keeps its id and is recognised above. One
       * that was closed and reopened is, as far as the wire is concerned, a
       * stranger — so the name is the only thing left to recognise them by. It
       * is enough: the seat is taken, its owner is not connected, and nobody
       * else in the room is using that name.
       */
      const seat = this.state.players.find(
        (p) => !p.isHost && !p.connected && p.name.toLowerCase() === wanted.toLowerCase(),
      );

      if (seat) {
        this.reassignSeat(seat, sender.id);
        this.send(sender, { type: 'welcome', playerId: sender.id, state: this.state });
        this.broadcastState();
        return;
      }

      this.send(sender, {
        type: 'error',
        reason: 'That game has already started. To rejoin, use the name you had.',
      });
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

    const clean = wanted || `Player ${players.length + 1}`;
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
      leftAt: 0,
      progress: { drawn: [], named: [], step: 0, endsAt: 0, done: false },
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

  /**
   * Moves a seat, and everything hanging off it, to a new connection.
   *
   * The room keys a player's artwork, votes, moves and scores on their id, and
   * a reopened tab arrives with a different one. Rather than teach every
   * handler about aliases, the seat itself is renamed — in one place, where
   * the full list of things that point at a player can be seen at once and
   * checked against the state.
   */
  /**
   * Somebody is back. Every return path ends here, so none of them can forget
   * to call off the countdown that would have handed their fighter to a bot.
   */
  private welcomeBack(player: Player): void {
    player.connected = true;
    player.leftAt = 0;
  }

  private reassignSeat(player: Player, newId: string): void {
    const oldId = player.id;
    if (oldId === newId) {
      this.welcomeBack(player);
      return;
    }

    // Artwork and names, both keyed `${playerId}:${slot}`.
    for (const store of [this.art, this.names]) {
      for (const [key, value] of [...store]) {
        const [owner, slot] = key.split(':');
        if (owner !== oldId || !slot) continue;
        store.delete(key);
        store.set(`${newId}:${slot}`, value);
      }
    }

    // Their vote for a battleground.
    if (this.state.votes[oldId] !== undefined) {
      this.state.votes[newId] = this.state.votes[oldId]!;
      delete this.state.votes[oldId];
    }

    const turn = this.state.turn;
    if (turn) {
      turn.fighters = turn.fighters.map((id) => (id === oldId ? newId : id)) as [string, string];
      if (turn.first === oldId) turn.first = newId;

      // Their move, the damage they dealt, the note about it.
      for (const record of [turn.moves, turn.damage, turn.notes] as Record<string, unknown>[]) {
        if (record[oldId] === undefined) continue;
        record[newId] = record[oldId];
        delete record[oldId];
      }

      // Scores they gave as a judge, and scores given to them as a fighter.
      if (turn.judged[oldId]) {
        turn.judged[newId] = turn.judged[oldId]!;
        delete turn.judged[oldId];
      }
      for (const byFighter of Object.values(turn.judged)) {
        if (byFighter[oldId] === undefined) continue;
        byFighter[newId] = byFighter[oldId]!;
        delete byFighter[oldId];
      }
    }

    player.id = newId;
    this.welcomeBack(player);
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
    // Two players are simply opposite each other. Done here rather than on
    // joining, so a third arriving turns it back into a game of teams that the
    // host arranges.
    if (isDuel(this.state)) {
      const pair = this.state.players.filter((p) => !p.isHost);
      pair.forEach((player, i) => { player.role = i === 0 ? 'teamA' : 'teamB'; });
      this.state.teamNames = {
        teamA: pair[0]?.name ?? 'Team One',
        teamB: pair[1]?.name ?? 'Team Two',
      };
    }

    this.state.phase = 'creating';
    this.beginCreation();
  }

  // ------------------------------------------------------------------ creating

  /**
   * Starts a creation step and sets its deadline.
   *
   * The deadline is an absolute time rather than a duration, so a phone that
   * slept or joined late lands on the same instant as everyone else instead of
   * starting its own countdown.
   */
  /**
   * Starts everyone on their own first step.
   *
   * One clock per player rather than one for the room. The old arrangement
   * marched everybody through the same step together, so four people waited on
   * a fifth to think of a name, four times over — and the person still drawing
   * got no more time for it either way.
   */
  private beginCreation(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);

    const steps = stepsFor(this.state);
    const first = steps[0];
    if (!first) {
      this.finishCreation();
      return;
    }

    const now = Date.now();
    for (const player of this.state.players) {
      player.progress.step = 0;
      player.progress.done = false;
      player.progress.endsAt = now + first.seconds * 1000;
    }

    this.state.step = 0;
    this.summariseDeadline();
    this.startCreationClock();
    this.broadcastState();
  }

  /**
   * Moves one player to their next step.
   *
   * Called when they finish one and when their own time runs out; the two are
   * the same event as far as the room is concerned, which is why a player who
   * runs out of time keeps whatever the drawing tool last saved.
   */
  private advancePlayer(player: Player): void {
    const steps = stepsFor(this.state);
    player.progress.step += 1;

    const next = steps[player.progress.step];
    if (!next) {
      player.progress.done = true;
      player.progress.endsAt = 0;
      this.finishIfEveryoneIsDone();
      return;
    }

    player.progress.endsAt = Date.now() + next.seconds * 1000;
    this.state.step = Math.max(this.state.step, player.progress.step);
    this.summariseDeadline();
  }

  /**
   * Watches every player's own deadline.
   *
   * One timer for the room rather than one per player: a handful of people
   * checked twice a second costs nothing, and there is no set of timers to
   * lose track of when somebody leaves.
   */
  private startCreationClock(): void {
    if (this.creationClock) clearInterval(this.creationClock);
    this.creationClock = setInterval(() => {
      if (!this.isCreating()) {
        this.stopCreationClock();
        return;
      }

      const now = Date.now();
      let moved = false;
      for (const player of creators(this.state)) {
        if (player.progress.done || player.progress.endsAt > now) continue;
        this.advancePlayer(player);
        moved = true;
      }
      if (moved) this.broadcastState();
    }, 500);
  }

  /**
   * Watches for anyone who has been gone too long.
   *
   * What happens then depends on where the game is: in the lobby their seat is
   * freed for somebody else, in creation they stop being waited for, and in a
   * fight a bot picks up their turn. All of it waits out the grace period
   * first, so a locked phone costs nothing.
   */
  private startGraceClock(): void {
    if (this.graceClock) return;

    this.graceClock = setInterval(() => {
      const away = this.state.players.filter((p) => !p.connected && p.leftAt > 0);
      if (away.length === 0) {
        this.stopGraceClock();
        return;
      }

      let changed = false;
      for (const player of away) {
        if (graceExpired(player)) changed = this.giveUpOn(player) || changed;
      }

      // A fight does not wait either, once the grace is up.
      this.playBots();
      if (changed) this.broadcastState();
    }, 1000);
  }

  /**
   * Stops waiting for one player, whatever the room is in the middle of.
   *
   * Reached two ways: the grace period running out, and the player saying
   * outright that they are leaving. Both mean the same thing by the time they
   * get here, so both take the same door — the difference between them is only
   * how long it took to be sure.
   *
   * Answers whether anything actually changed, so a tick that did nothing does
   * not broadcast.
   */
  private giveUpOn(player: Player): boolean {
    if (this.state.phase === 'lobby') {
      // Nothing has been made yet, so the seat can go to somebody else. The
      // host's is the exception: it is what makes the room findable, and
      // without it every join is answered "no game with that code".
      if (player.isHost) return false;
      this.state.players = this.state.players.filter((p) => p.id !== player.id);
      return true;
    }

    if (this.isCreating() && !player.progress.done) {
      // Nobody waits on an empty chair: their steps would expire one at a time
      // and hold the room for minutes. What they made is saved, and the rest
      // is filled in with stand-ins.
      player.progress.done = true;
      player.progress.endsAt = 0;
      this.finishIfEveryoneIsDone();
      return true;
    }

    return false;
  }

  /**
   * Someone has said they are going, rather than simply gone quiet.
   *
   * The grace period exists because a closed socket cannot tell the room
   * whether its owner meant it. This one did, so there is nothing to wait for:
   * leaving the lobby used to leave a ghost sitting in it marked
   * "reconnecting…" for twenty-five seconds, with the room counting them
   * towards the players it was waiting on.
   */
  private onLeave(sender: Party.Connection): void {
    const player = this.state.players.find((p) => p.id === sender.id);
    if (!player) return;

    player.connected = false;
    player.leftAt = Date.now() - GRACE_SECONDS * 1000;
    this.giveUpOn(player);
    this.playBots();
    this.broadcastState();
  }

  private stopGraceClock(): void {
    if (this.graceClock) clearInterval(this.graceClock);
    this.graceClock = null;
  }

  private stopCreationClock(): void {
    if (this.creationClock) clearInterval(this.creationClock);
    this.creationClock = null;
  }

  /** The room's clock shows whoever has the longest left to go. */
  private summariseDeadline(): void {
    const deadlines = creators(this.state)
      .filter((p) => !p.progress.done)
      .map((p) => p.progress.endsAt);
    this.state.stepEndsAt = deadlines.length > 0 ? Math.max(...deadlines) : 0;
  }

  /** Everyone finished, or nobody left to wait for. */
  private finishIfEveryoneIsDone(): void {
    const waiting = creators(this.state).filter((p) => !p.progress.done);
    if (waiting.length > 0) {
      this.summariseDeadline();
      return;
    }
    this.finishCreation();
  }

  /** Creation leads to the vote; an Ultimate leads straight back into the fight. */
  private finishCreation(): void {
    this.stopCreationClock();
    if (this.state.phase === 'ult') this.beginSuddenDeath();
    else this.beginVote();
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

  /** Every weapon slot that exists so far, Ultimates included. */
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
      // Gone, but not yet gone long enough: a locked phone gets its grace
      // period back before anything is written in its owner's name.
      if (!player || !graceExpired(player)) continue;
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
      player.progress = { drawn: [], named: [], step: 0, endsAt: 0, done: false };
      player.health = STARTING_HEALTH;
      player.fights = 0;
      player.characterName = '';
      player.weaponNames = [];
      player.damageDealt = 0;
      player.damageTaken = 0;
      player.best = null;
    }

    // Two players are simply opposite each other. Done here rather than on
    // joining, so a third arriving turns it back into a game of teams that the
    // host arranges.
    if (isDuel(this.state)) {
      const pair = this.state.players.filter((p) => !p.isHost);
      pair.forEach((player, i) => { player.role = i === 0 ? 'teamA' : 'teamB'; });
      this.state.teamNames = {
        teamA: pair[0]?.name ?? 'Team One',
        teamB: pair[1]?.name ?? 'Team Two',
      };
    }

    this.state.phase = 'creating';
    this.beginCreation();
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
    this.beginCreation();
  }

  /**
   * One more fight each, with the Ultimate in hand.
   *
   * Health is restored so a knocked-out fighter can still swing their
   * Ultimate —
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

  /** True while players are making things, in creation or in an Ultimate. */
  private isCreating(): boolean {
    return this.state.phase === 'creating' || this.state.phase === 'ult';
  }

  private onSubmitMove(weapon: number, prompt: string, sender: Party.Connection): void {
    const turn = this.state.turn;
    if (!turn || turn.phase !== 'picking') return;
    if (!turn.fighters.includes(sender.id)) return;

    // Clamped to what this player actually has, not to three.
    //
    // An Ultimate is a fourth weapon, and a hardcoded ceiling of two quietly
    // turned every Ultimate into the third weapon instead — the player picked
    // the thing they had just drawn and watched something else swing.
    const player = this.state.players.find((p) => p.id === sender.id);
    const owned = Math.max(1, player?.weaponNames.length ?? WEAPON_COUNT);

    turn.moves[sender.id] = {
      weapon: Math.max(0, Math.min(owned - 1, Math.floor(weapon) || 0)),
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
   *
   * Worked out before anyone's round count changes, because the multiplier
   * depends on whether this turn was their last — and by the end of this
   * function it will not be their last any more.
   */
  private closeJudging(): void {
    const final = isFinalRound(this.state);
    if (this.stepTimer) clearTimeout(this.stepTimer);
    const turn = this.state.turn;
    if (!turn || turn.phase !== 'judging') return;

    for (const attackerId of turn.fighters) {
      // The last round counts double, so a fight is never over until it is.
      const scored = averageScore(turn, attackerId);
      const dealt = final ? scored * FINAL_ROUND_MULTIPLIER : scored;
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
    // Their own step, their own clock: finishing moves them on and nobody
    // else. The room waits once, at the end.
    if (done) this.advancePlayer(player);
    this.broadcastState();
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
    this.advancePlayer(player);
    this.broadcastState();
  }

  /** "I have finished this step" — the same event as running out of time. */
  private onReady(sender: Party.Connection): void {
    const player = this.state.players.find((p) => p.id === sender.id);
    if (!player || !this.isCreating() || player.progress.done) return;
    this.advancePlayer(player);
    this.broadcastState();
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
