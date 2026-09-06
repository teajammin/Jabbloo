/**
 * Wire protocol shared by the browser and the PartyKit room.
 *
 * Imported by both sides so a change to a message shape breaks the compile
 * rather than surfacing as a silent runtime mismatch between host and phone.
 */

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
  | { type: 'ready' };

// --------------------------------------------------------------- server -> client

export type ServerMessage =
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
