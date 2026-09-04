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
 * Whether the lobby is ready to start.
 *
 * Kept here rather than in the server so the host's Start button and the
 * server's validation cannot drift apart — one is the UI for the other.
 */
export function canStart(state: RoomState): boolean {
  const active = state.players.filter((p) => !p.isHost);
  if (active.length < MIN_PLAYERS) return false;
  if (active.some((p) => p.role === 'unassigned')) return false;

  const fighters = active.filter((p) => p.role === 'teamA' || p.role === 'teamB');
  if (fighters.length < MIN_PLAYERS) return false;

  // A two-fighter game is 1v1; anything larger needs both sides populated.
  const a = active.filter((p) => p.role === 'teamA').length;
  const b = active.filter((p) => p.role === 'teamB').length;
  return a >= 1 && b >= 1;
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
