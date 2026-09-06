import { el } from './screens';

/**
 * A countdown to an absolute instant.
 *
 * Counting down to a timestamp rather than ticking a duration means a phone
 * that slept, or joined the step late, lands on the same moment as everyone
 * else instead of running its own clock.
 */
export interface Countdown {
  root: HTMLElement;
  /** Point at a new deadline, or 0 to stop. */
  setDeadline: (endsAt: number, totalSeconds: number) => void;
  stop: () => void;
}

export function countdown(onExpire?: () => void): Countdown {
  const label = el('span', { class: 'timer-label' }, '');
  const fill = el('div', { class: 'timer-fill' });
  const bar = el('div', { class: 'timer-bar' }, fill);
  const root = el('div', { class: 'timer' }, bar, label);
  root.setAttribute('role', 'timer');

  let endsAt = 0;
  let total = 1;
  let frame = 0;
  let expired = false;

  const tick = () => {
    const left = Math.max(0, endsAt - Date.now());
    const seconds = Math.ceil(left / 1000);
    label.textContent = `${seconds}s`;
    fill.style.width = `${Math.max(0, Math.min(100, (left / (total * 1000)) * 100))}%`;
    // Warn only in the last five seconds; colouring it earlier makes the whole
    // step feel like an emergency.
    root.classList.toggle('is-urgent', left <= 5000 && left > 0);

    if (left <= 0) {
      if (!expired) {
        expired = true;
        onExpire?.();
      }
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  return {
    root,
    setDeadline(next, totalSeconds) {
      if (frame) cancelAnimationFrame(frame);
      endsAt = next;
      total = Math.max(1, totalSeconds);
      expired = false;
      root.hidden = next === 0;
      if (next === 0) { frame = 0; return; }
      tick();
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
