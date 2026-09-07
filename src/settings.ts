/**
 * Player settings: accessibility and volume.
 *
 * Persisted per device rather than per room, because they describe the person
 * holding the phone, not the game they happen to be in — a player who needs
 * larger text needs it in the next game too.
 *
 * Applying them is CSS-first: a data attribute on <html> that the stylesheet
 * responds to, so no screen has to check a setting to render correctly.
 */

export interface Settings {
  /** Cuts animation to a minimum, for motion sensitivity. */
  reduceMotion: boolean;
  /** Scales the whole interface up. */
  largeText: boolean;
  /** Darker ink on plainer backgrounds, for low vision. */
  highContrast: boolean;
  /** 0–1. Music is the background bed, sfx are the hits and clicks. */
  music: number;
  sfx: number;
}

const KEY = 'jabbloo.settings';

const DEFAULTS: Settings = {
  // Seeded from the OS preference, so someone who has already asked their
  // phone for less motion does not have to ask again here.
  reduceMotion:
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches,
  largeText: false,
  highContrast: false,
  music: 0.5,
  sfx: 0.8,
};

let current: Settings = { ...DEFAULTS };
const listeners = new Set<(settings: Settings) => void>();

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

/**
 * Coerces a stored flag to a real boolean.
 *
 * A hand-edited store can hold anything; letting a string through would put a
 * truthy non-boolean into state that is later serialised back out, which is
 * how one bad edit becomes permanent.
 */
function flag(value: unknown, fallback: boolean): boolean {
  return value === undefined || value === null ? fallback : Boolean(value);
}

/** Reads what was stored, ignoring anything malformed rather than throwing. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Settings>;
      current = {
        reduceMotion: flag(stored.reduceMotion, DEFAULTS.reduceMotion),
        largeText: flag(stored.largeText, DEFAULTS.largeText),
        highContrast: flag(stored.highContrast, DEFAULTS.highContrast),
        music: clamp01(stored.music, DEFAULTS.music),
        sfx: clamp01(stored.sfx, DEFAULTS.sfx),
      };
    }
  } catch {
    // Private browsing, a full disk, or hand-edited nonsense: defaults are a
    // perfectly good game, so none of it is worth failing a launch over.
  }
  apply();
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not being able to remember a preference is not a reason to ignore it.
  }
  apply();
  for (const listener of listeners) listener(current);
  return current;
}

export function onSettingsChange(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pushes the settings onto <html>, where the stylesheet can see them. */
function apply(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.toggleAttribute('data-reduce-motion', current.reduceMotion);
  root.toggleAttribute('data-large-text', current.largeText);
  root.toggleAttribute('data-high-contrast', current.highContrast);
}
