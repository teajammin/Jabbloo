import type { JoinDetails } from './lobby';

/**
 * Getting back into a game this device was already in.
 *
 * A tab that reloads loses everything it knew — and tabs reload for reasons
 * nobody chose: a renderer crash under memory pressure, a phone reclaiming the
 * page it had backgrounded, a stray gesture. The room survives all of those on
 * the server, and the seat is held open for a while, but the device came back
 * to the front page with no idea that a game was going on.
 *
 * So the room is remembered here, and offered back on the next load.
 *
 * Session storage, like the device id it has to stay consistent with: both
 * belong to this tab and both survive a reload. A tab closed on purpose takes
 * both with it, which is the right answer — that was somebody leaving.
 */

const KEY = 'jabbloo:room';

export interface RememberedRoom {
  code: string;
  isHost: boolean;
  capacity: number;
  /** A player's name, so the seat can be reclaimed by it. Never their photo. */
  join?: JoinDetails;
}

export function rememberRoom(room: RememberedRoom): void {
  try {
    // The photo is deliberately dropped: it is the one field big enough to
    // blow the storage quota, and the seat is reclaimed by name.
    const { join, ...rest } = room;
    sessionStorage.setItem(KEY, JSON.stringify(
      join ? { ...rest, join: { name: join.name } } : rest,
    ));
  } catch {
    // A browser with storage switched off simply does not get to resume.
  }
}

export function forgetRoom(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was remembered, which is the state we wanted.
  }
}

/** The room this tab was in, if it was in one and the note is intact. */
export function rememberedRoom(): RememberedRoom | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<RememberedRoom>;
    if (typeof value.code !== 'string' || value.code.length === 0) return null;

    return {
      code: value.code,
      isHost: value.isHost === true,
      capacity: typeof value.capacity === 'number' ? value.capacity : 2,
      ...(value.join && typeof value.join.name === 'string'
        ? { join: { name: value.join.name } }
        : {}),
    };
  } catch {
    return null;
  }
}
