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
  const { height = 90, jitter = 0, className } = options;

  const wrap = document.createElement('span');
  wrap.className = ['bubble-text', className].filter(Boolean).join(' ');
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
    wrap.appendChild(img);
  }

  return wrap;
}
