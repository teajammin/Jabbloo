/**
 * Bubble lettering for DOM screens.
 *
 * The engine has a Pixi version for the canvas; this is the same alphabet
 * rendered as <img> elements, for the launch screen, room codes and headings.
 * Both read the same glyph files, so the title looks identical in both places.
 */

const ALIASES: Record<string, string> = {
  '!': 'excl',
  '?': 'query',
  '.': 'dot',
  ',': 'comma',
};

function glyphName(char: string): string | null {
  const upper = char.toUpperCase();
  if (upper >= 'A' && upper <= 'Z') return upper;
  return ALIASES[char] ?? null;
}

export interface BubbleTextOptions {
  /** Cap height in CSS pixels. */
  height?: number;
  /** Random vertical wobble in pixels, for a hand-placed look. */
  jitter?: number;
  className?: string;
  /**
   * Gives each letter a slow bob of its own.
   *
   * For the title and nothing else: a word that moves draws the eye, which is
   * what a title is for and what a room code or a fighter's name is not.
   */
  bounce?: boolean;
}

/**
 * A heading size that suits the window it is in.
 *
 * Lettering fixed in pixels is either small on a laptop or overwhelming on a
 * phone. This takes the size a big screen should use and scales it down for
 * narrower ones, so a title fills the space it is given on both.
 */
export function titleHeight(ideal: number, min = 40): number {
  if (typeof window === 'undefined') return ideal;
  const room = Math.min(window.innerWidth * 0.82, window.innerHeight * 0.3);
  return Math.max(min, Math.min(ideal, Math.round(room * 0.62)));
}

/** Builds an element spelling `text` in the game's letters. */
export function bubbleText(text: string, options: BubbleTextOptions = {}): HTMLElement {
  const { height = 90, jitter = 0, className, bounce = false } = options;

  const glyphs: HTMLImageElement[] = [];
  const wrap = document.createElement('span');
  wrap.className = ['bubble-text', className, bounce ? 'is-bouncing' : '']
    .filter(Boolean).join(' ');
  // The letters are decorative images; the word itself must reach a screen reader.
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', text);
  wrap.style.setProperty('--bubble-height', `${height}px`);

  for (const char of text) {
    if (char === ' ') {
      const gap = document.createElement('span');
      gap.className = 'bubble-space';
      wrap.appendChild(gap);
      continue;
    }

    const name = glyphName(char);
    if (!name) continue;

    const img = document.createElement('img');
    img.src = `/letters/${name}.png`;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.draggable = false;
    if (jitter) {
      img.style.transform = `translateY(${(Math.random() * 2 - 1) * jitter}px)`;
    }

    if (bounce) {
      /*
       * Each letter on its own clock, and none of them a neat fraction of
       * another: letters bobbing in step read as one object moving, which is
       * the opposite of the intended effect.
       */
      const index = wrap.childElementCount;
      img.style.animationDelay = `${(index * 0.13).toFixed(2)}s`;
      img.style.animationDuration = `${(2.1 + (index % 3) * 0.27).toFixed(2)}s`;
    }
    wrap.appendChild(img);
    glyphs.push(img);
  }

  /*
   * The word arrives whole or not at all.
   *
   * Each letter is its own file with no size until it has loaded, so a title
   * assembled straight into the page grew a letter at a time, reflowing on
   * every arrival — and because they finish in whatever order the network
   * hands them back, the word appeared to spell itself out of sequence.
   *
   * Held invisible rather than absent, so it still takes its space and nothing
   * below it jumps when the word appears. A letter that never loads must not
   * hide the heading for good, so there is a deadline on it.
   */
  if (glyphs.length > 0) {
    wrap.classList.add('is-loading');
    const reveal = () => wrap.classList.remove('is-loading');
    const ready = glyphs.map((img) => (img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })));

    void Promise.all(ready).then(reveal);
    // Whatever happens, the word is on screen inside a second.
    setTimeout(reveal, 1000);
  }

  return wrap;
}
