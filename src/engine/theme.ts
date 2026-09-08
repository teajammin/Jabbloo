/**
 * Jabbloo palette.
 *
 * Sampled from the bubble-letter artwork in the design brief: soft pastels,
 * warm cream ground, no harsh contrast. Colours are PIXI-friendly hex numbers;
 * `cssPalette` mirrors them as strings for DOM chrome.
 *
 * Every colour lives here. Nothing downstream should hardcode a hex value.
 */

export const palette = {
  // Character / accent pastels, straight off the bubble letters
  butter: 0xfbd87f,
  coral: 0xf98b8b,
  mint: 0xb7e9ae,
  sky: 0xa5cdf2,
  lavender: 0xc9b6ec,
  aqua: 0xa5e6e4,
  blossom: 0xf7a8c4,
  peach: 0xffc49b,

  // Neutrals
  cream: 0xfffdf7,
  ink: 0x4a4458, // soft warm charcoal — outlines and text, never pure black
  shadow: 0x000000,
  highlight: 0xffffff,
} as const;

export type PaletteColour = keyof typeof palette;

/**
 * The four battlegrounds: real places, photographed.
 *
 * Each keeps a colour as well as a photograph. The colour is what the stage
 * paints while the image is still loading and what the selection screen tints
 * a card with, so nothing anywhere has to cope with a missing picture — it
 * just looks plainer for a moment.
 *
 * Photographs are from Pexels, whose licence allows commercial use without
 * attribution; they are credited in the options menu regardless.
 */
export const battlegrounds = [
  { id: 'cliffs', label: 'Cliffs', colour: 0x8fb8c9, image: '/battlegrounds/cliffs.jpg' },
  { id: 'forest', label: 'Forest', colour: 0xd8a86a, image: '/battlegrounds/forest.jpg' },
  { id: 'volcano', label: 'Volcano', colour: 0xc4562f, image: '/battlegrounds/volcano.jpg' },
  { id: 'dunes', label: 'Dunes', colour: 0xe0b877, image: '/battlegrounds/dunes.jpg' },
] as const;

export type BattlegroundId = (typeof battlegrounds)[number]['id'];

export function getBattleground(id: BattlegroundId) {
  const found = battlegrounds.find((b) => b.id === id);
  if (!found) throw new Error(`Unknown battleground: ${id}`);
  return found;
}

/** Hex number -> CSS string, for styling DOM elements from the same source. */
export function toCss(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/** Shared radii and spacing. Everything in Jabbloo is round and bubbly. */
export const shape = {
  radiusSmall: 12,
  radiusMedium: 24,
  radiusLarge: 40,
  radiusPill: 999,
} as const;
