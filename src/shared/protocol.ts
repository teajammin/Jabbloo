/**
 * Wire protocol shared by the browser and the PartyKit room.
 *
 * Imported by both sides so a change to a message shape breaks the compile
 * rather than surfacing as a silent runtime mismatch between host and phone.
 */

// The battleground list lives in the engine's theme, which has no imports of
// its own, so both the server and the canvas can share one definition rather
// than keeping two lists that drift apart.
export { battlegrounds, type BattlegroundId } from '../engine/theme';

/** The brief's cap on how much a player may write for one move. */
export const MAX_PROMPT_WORDS = 50;
/**
 * How long a player has to choose a weapon and describe the move.
 *
 * Shorter than it was: fifty words arrive long before a minute does, and the
 * time left over is spent watching a timer rather than writing.
 */
export const MOVE_SECONDS = 50;
/** Rounds each character fights. */
export const ROUNDS_EACH = 3;

/**
 * What a hit is worth in the final round.
 *
 * Three rounds of scores that all count the same makes the last one a
 * formality: whoever is ahead after two is usually ahead after three. Doubling
 * the last round means a fight is never over until it is over, and the player
 * who has been losing has something to swing for.
 */
export const FINAL_ROUND_MULTIPLIER = 2;

/**
 * Whether this turn is somebody's last.
 *
 * True when both fighters are on their final round, which in a one-a-side game
 * is the third turn and in a tag team is the last turn each pair will have.
 */
export function isFinalRound(state: RoomState): boolean {
  const turn = state.turn;
  if (!turn) return false;
  return turn.fighters.every((id) => {
    const player = state.players.find((p) => p.id === id);
    return player !== undefined && player.fights >= ROUNDS_EACH - 1;
  });
}
/** Everyone starts here; a fighter at zero is knocked out. */
export const STARTING_HEALTH = 100;
/** The brief's scale: a move is worth up to this much damage. */
export const MAX_SCORE = 33;
/** How long judges have to score an exchange. */
export const JUDGE_SECONDS = 30;

/** How long everyone has to pick a battleground. */
export const VOTE_SECONDS = 20;
/** How long the draw is shown before the battle starts. */
export const REVEAL_SECONDS = 4;

/**
 * The platform's hard limit on one websocket message.
 *
 * Cloudflare closes the connection outright when a message exceeds this —
 * code 1009, "Message is too large" — which is how an iPhone photo attached at
 * the join screen cost a player their seat: the socket died mid-join, the
 * client reconnected, and the player was never registered at all.
 */
export const MAX_MESSAGE_BYTES = 1_048_576;

/**
 * What one piece of artwork may weigh.
 *
 * Well under the hard limit, because the payload is only part of the message
 * and because a connection lost to a large drawing is far worse than a drawing
 * sent slightly smaller.
 */
export const MAX_ARTWORK_BYTES = 700_000;

/** An avatar is decoration; it does not need a camera's full resolution. */
export const MAX_PHOTO_BYTES = 120_000;

/** Rough byte length of a string once encoded, without building a buffer. */
export function byteLength(value: string): number {
  // Data URLs are base64 and therefore single-byte throughout, which is the
  // case this guards; TextEncoder would be exact but allocates a copy of a
  // megabyte-scale string to find out.
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(value).length
    : value.length;
}

/**
 * How long a device may be away before the game gives up on it.
 *
 * Phones lock, tabs get backgrounded, wifi drops for a moment. None of those
 * should cost a player their seat — but a room cannot wait forever either, so
 * after this the lobby lets them go and a fight hands their turn to a bot.
 */
export const GRACE_SECONDS = 25;

/** Whether a player has been gone long enough to be given up on. */
export function graceExpired(player: Player, now = Date.now()): boolean {
  if (player.connected || player.leftAt === 0) return false;
  return now - player.leftAt >= GRACE_SECONDS * 1000;
}

/** Seconds left before that happens, for a screen to count down. */
export function graceRemaining(player: Player, now = Date.now()): number {
  if (player.connected || player.leftAt === 0) return 0;
  return Math.max(0, Math.ceil((player.leftAt + GRACE_SECONDS * 1000 - now) / 1000));
}

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const ROOM_CODE_LENGTH = 4;

/** Where a player sits once the host has arranged the lobby. */
export type Role = 'unassigned' | 'teamA' | 'teamB' | 'judge';

export interface Player {
  id: string;
  name: string;
  /** Data URL of the player's optional lobby photo. */
  photo?: string;
  role: Role;
  connected: boolean;
  /** The host runs the shared screen; everyone else is on a phone. */
  isHost: boolean;
  /**
   * When they went, as an epoch millisecond. Zero while they are here.
   *
   * A disconnect is not a departure: it is a phone locking, a tab going to the
   * background, a train entering a tunnel. This is what lets the room tell the
   * difference between the two, by waiting.
   */
  leftAt: number;
  progress: CreationProgress;
  health: number;
  /** Rounds fought, so nobody fights a fourth time. */
  fights: number;
  /**
   * Names only — the artwork stays on the server.
   *
   * A few short strings are cheap to broadcast and every screen needs them:
   * the phone to label its weapon buttons, the host to caption the fight.
   */
  characterName: string;
  weaponNames: string[];
  /** Totals for the stats screen, accumulated across the fight. */
  damageDealt: number;
  damageTaken: number;
  /** Their hardest hit, kept whole so the screen can quote it. */
  best: { weapon: string; prompt: string; damage: number } | null;
}

export type Phase = 'lobby' | 'creating' | 'battleground' | 'battle' | 'ult' | 'results';

/** How many weapons each player makes, per the brief. */
export const WEAPON_COUNT = 3;

/**
 * The creation timeline.
 *
 * One flat list rather than nested loops: the server only has to know which
 * index it is on, and the client can render any step from its own definition.
 */
export type CreationKind = 'draw' | 'name';

export interface CreationStep {
  /** 'character' or 'weapon0'..'weapon2'. */
  slot: string;
  kind: CreationKind;
  seconds: number;
  prompt: string;
}

export const CREATION_STEPS: CreationStep[] = [
  { slot: 'character', kind: 'draw', seconds: 105, prompt: 'Draw your character' },
  { slot: 'character', kind: 'name', seconds: 20, prompt: 'Name your character' },
  ...Array.from({ length: WEAPON_COUNT }, (_, i) => [
    { slot: `weapon${i}`, kind: 'draw' as const, seconds: 60, prompt: `Draw weapon ${i + 1}` },
    { slot: `weapon${i}`, kind: 'name' as const, seconds: 20, prompt: `Name weapon ${i + 1}` },
  ]).flat(),
];

/**
 * How many Ultimates a tie may force before the game accepts a draw.
 *
 * Without a cap two evenly matched teams could be sent back to the drawing
 * board forever; two extra weapons is already a long tail on a party game.
 */
export const MAX_ULTS = 2;

/**
 * The Ultimate round: one more weapon, on the same clock as a normal weapon.
 *
 * The slot continues the weapon numbering, so an Ultimate is simply a fourth (then
 * fifth) weapon — nothing downstream has to learn a new kind of thing.
 */
export function ultSteps(round: number): CreationStep[] {
  const slot = `weapon${WEAPON_COUNT + Math.max(0, round - 1)}`;
  return [
    { slot, kind: 'draw', seconds: 60, prompt: 'Draw your Ultimate' },
    { slot, kind: 'name', seconds: 20, prompt: 'Name your Ultimate' },
  ];
}

/** The step list the room is working through, whichever phase it is in. */
export function stepsFor(state: RoomState): CreationStep[] {
  if (state.phase === 'creating') return CREATION_STEPS;
  if (state.phase === 'ult') return ultSteps(state.ultRound);
  return [];
}

/** One player's move for the current turn. */
export interface Move {
  /** Index into their three weapons. */
  weapon: number;
  prompt: string;
}

/** What is happening on the battle stage right now. */
export type TurnPhase = 'entering' | 'picking' | 'playing' | 'judging' | 'over';

export interface Turn {
  /**
   * Which turn of the battle this is, counting from one.
   *
   * Screens key their state on it. Without an identity, a second round between
   * the same two fighters is indistinguishable from the first — which is
   * exactly how the judges' sliders stopped rebuilding after round one, and
   * why judges could not score again for the rest of the game.
   */
  index: number;
  /** The two players on stage: team A's fighter, then team B's. */
  fighters: [string, string];
  moves: Record<string, Move>;
  /**
   * Scores by judge, then by the fighter being judged.
   *
   * Kept per judge rather than pre-averaged so a late score still counts and
   * a judge can change their mind before the round closes.
   */
  judged: Record<string, Record<string, number>>;
  /** The averaged damage each fighter dealt, once judging has closed. */
  damage: Record<string, number>;
  /** What the AI judge said, shown on the big screen. */
  notes: Record<string, string>;
  /**
   * Who strikes first, drawn once both moves are in.
   *
   * The brief has the AI pick at random, so neither player gains anything by
   * submitting first — which they otherwise would, having seen nothing.
   */
  first: string | null;
  phase: TurnPhase;
}

/** What a player has finished so far. Artwork itself stays on the server. */
/**
 * How far one player has got, on their own clock.
 *
 * Creation used to march everyone through the same step together, which meant
 * four people waiting on a fifth to think of a name, four times over. Each
 * player now walks their own path and waits only at the end — where waiting is
 * unavoidable, and where at least it is visible who is being waited for.
 */
export interface CreationProgress {
  /** Slots with a drawing submitted. */
  drawn: string[];
  /** Slots with a name submitted. */
  named: string[];
  /** Which step this player is on. Past the last one means finished. */
  step: number;
  /** When this player's current step runs out, as an epoch millisecond. */
  endsAt: number;
  /** True once they have finished everything and are waiting for the others. */
  done: boolean;
}

/** The step a particular player is on, or null when they have finished. */
export function stepFor(state: RoomState, playerId: string): CreationStep | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;
  return stepsFor(state)[player.progress.step] ?? null;
}

/** Everyone still working, for a waiting screen to name. */
export function stillWorking(state: RoomState): Player[] {
  return creators(state).filter((p) => !p.progress.done);
}

export interface RoomState {
  code: string;
  phase: Phase;
  /** How many players the host said would join. */
  capacity: number;
  players: Player[];
  teamNames: { teamA: string; teamB: string };
  /**
   * The furthest step anyone has reached, for the host's screen to caption.
   *
   * Each player's own step lives on their progress; this is a summary, not the
   * thing the game runs on.
   */
  step: number;
  /** Ultimates played so far; 0 until a tie forces one. */
  ultRound: number;
  /** Battleground picks, by player id. Everyone votes, judges included. */
  votes: Record<string, string>;
  /** The drawn battleground, once the vote has closed. */
  chosen: string | null;
  /**
   * Who has said they are up for another one, while a rematch is being called.
   *
   * Null when none is. The host pressing Rematch does not start one: everybody
   * still in the room has to say they are in first, or a player who had put
   * their phone down to talk to somebody arrives to find round one already
   * being fought without them.
   */
  rematchReady: string[] | null;
  /** The turn being fought, or null outside the battle. */
  turn: Turn | null;
  /**
   * When the current step ends, as an epoch millisecond.
   *
   * The server owns the clock and everyone counts down to the same instant,
   * so phones that joined late or slept do not drift out of step.
   */
  stepEndsAt: number;
}

// --------------------------------------------------------------- client -> server

export type ClientMessage =
  | { type: 'host'; capacity: number }
  | { type: 'join'; name: string; photo?: string }
  | { type: 'setRole'; playerId: string; role: Role }
  | { type: 'setTeamName'; team: 'teamA' | 'teamB'; name: string }
  /**
   * Leaving on purpose — the Leave button, or walking back out of the lobby.
   *
   * A closed socket cannot say whether its owner meant it, which is why the
   * room waits [[GRACE_SECONDS]] before giving up on one. Someone who pressed
   * Leave has already said so, and should not sit in the lobby as a ghost
   * marked "reconnecting…" for the next twenty-five seconds.
   */
  | { type: 'leave' }
  | { type: 'start' }
  /**
   * A drawing for a slot, as a PNG data URL.
   *
   * `done` separates "I have finished this step" from "here is my work so
   * far". The drawing tool saves as it goes, and an autosave that also said
   * the player was ready would end the step early — for everyone, since the
   * room moves on as soon as the last person is ready.
   */
  | { type: 'submitDrawing'; slot: string; png: string; done?: boolean }
  | { type: 'submitName'; slot: string; name: string }
  /** Done early; the step advances once everyone has said so. */
  | { type: 'ready' }
  | { type: 'voteBattleground'; id: string }
  /** The host asks for everyone's artwork once the battle starts. */
  | { type: 'requestArt' }
  | { type: 'submitMove'; weapon: number; prompt: string }
  /** The host reports that the exchange has finished playing. */
  /** The host reports the exchange has finished playing; judging opens. */
  | { type: 'turnPlayed' }
  | { type: 'submitScore'; attackerId: string; score: number }
  | { type: 'submitNote'; attackerId: string; note: string }
  | { type: 'turnDone' }
  /** Back to battleground selection, keeping the same characters. */
  | { type: 'rematch' }
  /** "I am in" — the answer to a rematch the host has called. */
  | { type: 'rejoin' }
  /** Everything again from scratch: new characters, new weapons. */
  | { type: 'newGame' }
  /** The host is closing the room; every device is sent back to the menu. */
  | { type: 'closeRoom' };

// --------------------------------------------------------------- server -> client

/** One player's finished work, sent only when the battle needs it. */
export interface PlayerArt {
  playerId: string;
  character: { png: string; name: string } | null;
  weapons: { png: string; name: string }[];
}

export type ServerMessage =
  | { type: 'art'; art: PlayerArt[] }
  /** The room is over. Clients go back to the launch screen. */
  | { type: 'closed' }
  | { type: 'state'; state: RoomState }
  | { type: 'welcome'; playerId: string; state: RoomState }
  | { type: 'error'; reason: string };

/**
 * Why the lobby cannot start yet, or null when it can.
 *
 * Returns a reason rather than a boolean so the host screen can say what is
 * missing instead of showing a dulled button with no explanation.
 *
 * Kept here rather than in the server so the host's Start button and the
 * server's validation cannot drift apart — one is the UI for the other.
 */
/**
 * Trims a written move to the brief's limit.
 *
 * Counting words rather than characters, since that is what the brief asks
 * for and what a player is thinking in.
 */
export function trimPrompt(text: string, max = MAX_PROMPT_WORDS): string {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, max).join(' ');
}

export function wordCount(text: string): number {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/** Fighters still standing and still owed rounds. */
export function availableFighters(state: RoomState, team: Role): Player[] {
  return state.players.filter(
    (p) => p.role === team && p.health > 0 && p.fights < ROUNDS_EACH,
  );
}

/**
 * Total damage a team has taken.
 *
 * The brief's win condition is least damage taken, not most dealt — a team can
 * hit hard and still lose by being hit harder.
 */
export function teamDamage(state: RoomState, team: Role): number {
  return state.players
    .filter((p) => p.role === team)
    .reduce((sum, p) => sum + p.damageTaken, 0);
}

/** Which side won, or null when they are level and an Ultimate is owed. */
export function winningTeam(state: RoomState): Role | null {
  const a = teamDamage(state, 'teamA');
  const b = teamDamage(state, 'teamB');
  if (a === b) return null;
  return a < b ? 'teamA' : 'teamB';
}

/** The players scoring this game. Empty in a two-player game, where AI judges. */
export function judges(state: RoomState): Player[] {
  return state.players.filter((p) => !p.isHost && p.role === 'judge');
}

/**
 * The damage a fighter dealt, averaged across judges.
 *
 * The brief says two judges average, so any number of them does. With no
 * judges the AI's single score stands on its own.
 */
export function averageScore(turn: Turn, attackerId: string): number {
  const scores = Object.values(turn.judged)
    .map((byFighter) => byFighter[attackerId])
    .filter((n): n is number => typeof n === 'number');
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length);
}

/** Everyone with a vote: fighters and judges alike, but not the host screen. */
export function voters(state: RoomState): Player[] {
  return state.players.filter((p) => !p.isHost && p.role !== 'unassigned');
}

/**
 * Draws a battleground from the votes.
 *
 * Every vote is one ticket and one ticket is pulled, so a ground with more
 * votes is likelier but never certain — which is the point of the Mario Kart
 * rule the brief asks for. Majority-wins would make three of the four grounds
 * unreachable in most rooms.
 */
export function drawBattleground(
  votes: Record<string, string>,
  ids: readonly string[],
  random: () => number = Math.random,
): string {
  const tickets = Object.values(votes).filter((id) => ids.includes(id));
  const pool = tickets.length > 0 ? tickets : ids;
  return pool[Math.floor(random() * pool.length)] ?? ids[0]!;
}

/** Players who actually create things. Judges sit the creation phase out. */
export function creators(state: RoomState): Player[] {
  return state.players.filter((p) => !p.isHost && p.role !== 'judge' && p.role !== 'unassigned');
}

/** The step being worked on, or null outside the creation phase. */
export function currentStep(state: RoomState): CreationStep | null {
  return stepsFor(state)[state.step] ?? null;
}

/**
 * Whether this room is a duel rather than a game of teams.
 *
 * Two people are not two teams. Asking them to drag each other into Team One
 * and Team Two before they can start is a ceremony with no content — there is
 * exactly one arrangement, and the room can make it itself.
 */
/**
 * Who a called rematch is still waiting on.
 *
 * Only players who are actually here: somebody whose phone has gone should not
 * be able to hold the room hostage, and the grace period has already decided
 * whether they are coming back.
 */
export function holdingUpRematch(state: RoomState): Player[] {
  const ready = state.rematchReady;
  if (ready === null) return [];
  return state.players.filter(
    (p) => !p.isHost && p.connected && !ready.includes(p.id),
  );
}

/**
 * A player's name as the room should see it.
 *
 * Somebody whose phone has been gone longer than the grace period is being
 * played by a bot, and that is worth knowing at a glance — the room otherwise
 * spends the round wondering why they are attacking like that. A tag on the
 * name says it everywhere at once, in the same words.
 */
export function displayName(player: Player, now = Date.now()): string {
  return graceExpired(player, now) ? `${player.name} (BOT)` : player.name;
}

export function isDuel(state: RoomState): boolean {
  return state.players.filter((p) => !p.isHost).length === 2;
}

export function startBlockedBecause(state: RoomState): string | null {
  const active = state.players.filter((p) => !p.isHost);

  if (active.length < MIN_PLAYERS) {
    return `Waiting for ${MIN_PLAYERS - active.length} more player${
      MIN_PLAYERS - active.length === 1 ? '' : 's'
    }.`;
  }

  // A duel arranges itself when the game starts.
  if (isDuel(state)) return null;

  const waiting = active.filter((p) => p.role === 'unassigned');
  if (waiting.length > 0) {
    return waiting.length === 1
      ? `${waiting[0]!.name} still needs a place.`
      : `${waiting.length} players still need a place.`;
  }

  const a = active.filter((p) => p.role === 'teamA').length;
  const b = active.filter((p) => p.role === 'teamB').length;
  if (a === 0 || b === 0) return 'Both teams need at least one fighter.';

  return null;
}

export function canStart(state: RoomState): boolean {
  return startBlockedBecause(state) === null;
}

/** Codes avoid vowels so the generator cannot produce a real word. */
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}
