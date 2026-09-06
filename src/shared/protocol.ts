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
/** How long a player has to choose a weapon and describe the move. */
export const MOVE_SECONDS = 60;
/** Rounds each character fights. */
export const ROUNDS_EACH = 3;
/** Everyone starts here; a fighter at zero is knocked out. */
export const STARTING_HEALTH = 100;

/** How long everyone has to pick a battleground. */
export const VOTE_SECONDS = 20;
/** How long the draw is shown before the battle starts. */
export const REVEAL_SECONDS = 4;

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
}

export type Phase = 'lobby' | 'creating' | 'battleground' | 'battle' | 'results';

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
  { slot: 'character', kind: 'draw', seconds: 90, prompt: 'Draw your character' },
  { slot: 'character', kind: 'name', seconds: 20, prompt: 'Name your character' },
  ...Array.from({ length: WEAPON_COUNT }, (_, i) => [
    { slot: `weapon${i}`, kind: 'draw' as const, seconds: 45, prompt: `Draw weapon ${i + 1}` },
    { slot: `weapon${i}`, kind: 'name' as const, seconds: 20, prompt: `Name weapon ${i + 1}` },
  ]).flat(),
];

/** One player's move for the current turn. */
export interface Move {
  /** Index into their three weapons. */
  weapon: number;
  prompt: string;
}

/** What is happening on the battle stage right now. */
export type TurnPhase = 'entering' | 'picking' | 'playing' | 'judging' | 'over';

export interface Turn {
  /** The two players on stage: team A's fighter, then team B's. */
  fighters: [string, string];
  moves: Record<string, Move>;
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
export interface CreationProgress {
  /** Slots with a drawing submitted. */
  drawn: string[];
  /** Slots with a name submitted. */
  named: string[];
  /** True once they have finished the current step. */
  ready: boolean;
}

export interface RoomState {
  code: string;
  phase: Phase;
  /** How many players the host said would join. */
  capacity: number;
  players: Player[];
  teamNames: { teamA: string; teamB: string };
  /** Index into CREATION_STEPS while creating, else -1. */
  step: number;
  /** Battleground picks, by player id. Everyone votes, judges included. */
  votes: Record<string, string>;
  /** The drawn battleground, once the vote has closed. */
  chosen: string | null;
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
  | { type: 'start' }
  /** A finished drawing for a slot, as a PNG data URL. */
  | { type: 'submitDrawing'; slot: string; png: string }
  | { type: 'submitName'; slot: string; name: string }
  /** Done early; the step advances once everyone has said so. */
  | { type: 'ready' }
  | { type: 'voteBattleground'; id: string }
  /** The host asks for everyone's artwork once the battle starts. */
  | { type: 'requestArt' }
  | { type: 'submitMove'; weapon: number; prompt: string }
  /** The host reports that the exchange has finished playing. */
  | { type: 'turnDone' };

// --------------------------------------------------------------- server -> client

/** One player's finished work, sent only when the battle needs it. */
export interface PlayerArt {
  playerId: string;
  character: { png: string; name: string } | null;
  weapons: { png: string; name: string }[];
}

export type ServerMessage =
  | { type: 'art'; art: PlayerArt[] }
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
  return state.phase === 'creating' ? CREATION_STEPS[state.step] ?? null : null;
}

export function startBlockedBecause(state: RoomState): string | null {
  const active = state.players.filter((p) => !p.isHost);

  if (active.length < MIN_PLAYERS) {
    return `Waiting for ${MIN_PLAYERS - active.length} more player${
      MIN_PLAYERS - active.length === 1 ? '' : 's'
    }.`;
  }

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
