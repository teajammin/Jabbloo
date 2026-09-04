import { Container, Sprite, Texture, Assets } from 'pixi.js';

/**
 * Text rendered from the game's own bubble-letter artwork.
 *
 * The brief specifies these letters for the title, big screen titles, and
 * character / weapon names — so this is a sprite compositor rather than a font:
 * each glyph is a PNG cut from the source alphabet.
 *
 * Only the characters in the source artwork exist (A-Z ! ? . ,). Anything else
 * is skipped, and lowercase is folded to uppercase, since there is no
 * lowercase set. Player-supplied names are therefore always safe to pass in.
 */

const GLYPH_ALIASES: Record<string, string> = {
  '!': 'excl',
  '?': 'query',
  '.': 'dot',
  ',': 'comma',
};

export interface BubbleTextOptions {
  /** Cap height in pixels. Glyphs share one scale factor, preserving proportions. */
  height?: number;
  /** Gap between glyphs, as a fraction of height. Negative values tuck them closer. */
  tracking?: number;
  /** Width of a space, as a fraction of height. */
  spaceWidth?: number;
  /** Random vertical wobble in pixels, for a hand-placed look. 0 disables. */
  jitter?: number;
  /** Where the glyph PNGs live. */
  basePath?: string;
}

export class BubbleText extends Container {
  private constructor() {
    super();
  }

  /** Maps a character to its sprite filename, or null if unrepresentable. */
  private static glyphName(char: string): string | null {
    const upper = char.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return upper;
    return GLYPH_ALIASES[char] ?? null;
  }

  static async create(text: string, options: BubbleTextOptions = {}): Promise<BubbleText> {
    const {
      height = 120,
      tracking = -0.02,
      spaceWidth = 0.34,
      jitter = 0,
      basePath = '/letters',
    } = options;

    const instance = new BubbleText();

    // Resolve every glyph first so a missing asset fails before anything is
    // laid out, rather than leaving a half-drawn title on screen.
    const chars = [...text];
    const needed = [
      ...new Set(
        chars.map((c) => BubbleText.glyphName(c)).filter((n): n is string => n !== null),
      ),
    ];
    const textures = new Map<string, Texture>();
    await Promise.all(
      needed.map(async (name) => {
        textures.set(name, await Assets.load<Texture>(`${basePath}/${name}.png`));
      }),
    );

    let cursor = 0;
    for (const char of chars) {
      if (char === ' ') {
        cursor += height * spaceWidth;
        continue;
      }

      const name = BubbleText.glyphName(char);
      if (!name) continue;

      const texture = textures.get(name);
      if (!texture) continue;

      const sprite = new Sprite(texture);
      // Every glyph is exported at the same height, so scaling each by its own
      // texture height keeps them consistent and survives the artwork being
      // regenerated at a different resolution.
      sprite.scale.set(height / texture.height);
      // Bottom-anchored so glyphs of differing heights share a baseline.
      sprite.anchor.set(0, 1);
      sprite.x = cursor;
      sprite.y = jitter ? (Math.random() * 2 - 1) * jitter : 0;

      instance.addChild(sprite);
      cursor += sprite.width + height * tracking;
    }

    return instance;
  }
}
