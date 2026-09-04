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
}

export type Phase = 'lobby' | 'characters' | 'weapons' | 'battleground' | 'battle' | 'results';

export interface RoomState {
  code: string;
  phase: Phase;
  /** How many players the host said would join. */
  capacity: number;
  players: Player[];
  teamNames: { teamA: string; teamB: string };
}

// --------------------------------------------------------------- client -> server

export type ClientMessage =
  | { type: 'host'; capacity: number }
  | { type: 'join'; name: string; photo?: string }
  | { type: 'setRole'; playerId: string; role: Role }
  | { type: 'setTeamName'; team: 'teamA' | 'teamB'; name: string }
  | { type: 'start' };

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
