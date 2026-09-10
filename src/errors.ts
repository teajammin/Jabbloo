import { VERSION } from './version';

/**
 * Catching what breaks on somebody else's device.
 *
 * A party game is played on six phones the developer will never hold. When one
 * of them throws, the only person who finds out is the player — who sees a
 * screen stop responding and has no way to say what happened. This sends the
 * error somewhere it can be read, and tells the player something honest
 * instead of leaving them looking at a frozen game.
 *
 * Three rules govern everything here:
 *
 *   It must never make things worse. Every path is wrapped, the send is
 *   fire-and-forget, and a failure to report is simply dropped — an error
 *   reporter that throws is the worst possible bug.
 *
 *   It must not become a flood. A render loop that throws every frame would
 *   otherwise post thousands of times; identical errors are counted rather
 *   than resent, and there is a hard cap per session.
 *
 *   It must not carry anything private. What a player wrote is theirs; the
 *   report carries the error, where it happened and what the device is, and
 *   nothing else.
 */

/** Enough to diagnose, few enough to never be a burden. */
const MAX_REPORTS = 20;
/** Stacks are long and the top of one is where the answer lives. */
const MAX_STACK = 1200;

export interface ErrorReport {
  message: string;
  stack?: string;
  /** Where in the game it happened, as far as the page can tell. */
  screen: string;
  /** The room, when there is one, so a report can be tied to a session. */
  room?: string;
  version: string;
  agent: string;
  at: string;
  /** How many times this same error has happened since the page loaded. */
  count: number;
}

/** Which room this device is in, set by the connection when it joins one. */
let currentRoom = '';
export function setErrorContext(room: string): void {
  currentRoom = room;
}

const seen = new Map<string, number>();
let sent = 0;
let onFirstError: (() => void) | undefined;

/** The screen a player is looking at, taken from the DOM rather than tracked. */
function currentScreen(): string {
  try {
    const main = document.querySelector('[class*="screen-"]');
    const name = [...(main?.classList ?? [])].find((c) => c.startsWith('screen-'));
    return name ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Shapes one error into a report, or returns null if it should not be sent.
 *
 * Separated from the sending so the decisions — what to include, when to stop,
 * how repeats are counted — can be tested without a network.
 */
export function buildReport(error: unknown, screen: string): ErrorReport | null {
  const message = String(
    (error instanceof Error ? error.message : error) ?? 'unknown error',
  ).slice(0, 300);
  if (!message) return null;

  const stack = error instanceof Error && error.stack
    ? error.stack.slice(0, MAX_STACK)
    : undefined;

  // Keyed on the message and the first line of the stack: the same fault from
  // the same place, however many times it fires, is one thing to fix.
  const key = `${message}::${stack?.split('\n')[1]?.trim() ?? ''}`;
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);

  // Sent the first time, then at ten and a hundred — enough to show something
  // is repeating without repeating the report.
  if (count !== 1 && count !== 10 && count !== 100) return null;
  if (sent >= MAX_REPORTS) return null;
  sent++;

  return {
    message,
    ...(stack ? { stack } : {}),
    screen,
    ...(currentRoom ? { room: currentRoom } : {}),
    version: VERSION,
    agent: navigator.userAgent.slice(0, 200),
    at: new Date().toISOString(),
    count,
  };
}

/** Posts a report and forgets about it. */
function send(report: ErrorReport): void {
  try {
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      // The page may be closing — this is exactly when errors happen — and
      // keepalive is what lets the request outlive it.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // A reporter that throws while reporting helps nobody.
  }
}

/** Hands an error to the log, wherever it was caught. */
export function report(error: unknown): void {
  try {
    const shaped = buildReport(error, currentScreen());
    if (!shaped) return;
    console.error('[jabbloo]', shaped.message, error);
    send(shaped);
    if (shaped.count === 1) onFirstError?.();
  } catch {
    // As above.
  }
}

/**
 * Starts listening for anything the game does not catch itself.
 *
 * `notify` is called the first time something breaks, so a screen can tell the
 * player rather than leaving them staring at a game that has stopped.
 */
export function watchForErrors(notify?: () => void): () => void {
  onFirstError = notify;

  const onError = (event: ErrorEvent) => report(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => report(event.reason);

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    onFirstError = undefined;
  };
}

/** For tests: forgets what has been seen and sent. */
export function resetErrorLog(): void {
  seen.clear();
  sent = 0;
}
