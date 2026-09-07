import { el } from './screens';
import { CONNECTION_EVENT } from '../net/room';

/**
 * "Reconnecting…", when the room goes quiet.
 *
 * A dropped socket used to be invisible: the screen kept whatever it last
 * knew, so a host watched an empty lobby while players were joining a room it
 * could no longer hear. A game that has stopped talking to the server has to
 * say so, or every other symptom is a mystery.
 *
 * Mounted on <body> once, like the options menu, because a connection outlives
 * any single screen.
 */

/** Long enough that the reconnect after a phone unlocks passes unremarked. */
const GRACE_MS = 1200;

export function mountConnectionBanner(): () => void {
  const banner = el('div', { class: 'connection-banner' },
    'Reconnecting…');
  banner.setAttribute('role', 'status');
  banner.hidden = true;
  document.body.appendChild(banner);

  let timer: number | null = null;

  const onChange = (event: Event) => {
    const open = (event as CustomEvent<{ open: boolean }>).detail?.open === true;
    // window.setTimeout paired with window.clearTimeout: the two are the same
    // function in a browser, but not in every environment this code is run in,
    // and a timer set on one clock cannot be cancelled on another.
    if (timer !== null) { window.clearTimeout(timer); timer = null; }

    if (open) {
      banner.hidden = true;
      return;
    }
    // Waited out rather than shown at once: PartySocket reconnects on its own,
    // and a banner for every blip would be its own kind of noise.
    timer = window.setTimeout(() => { banner.hidden = false; }, GRACE_MS);
  };

  window.addEventListener(CONNECTION_EVENT, onChange);

  return () => {
    if (timer !== null) window.clearTimeout(timer);
    window.removeEventListener(CONNECTION_EVENT, onChange);
    banner.remove();
  };
}
