import { Assets, Texture } from 'pixi.js';

/**
 * One way in to the asset system.
 *
 * Pixi initialises its loader on first use, and several calls arriving at once
 * — the stage asking for a battleground while the effects and the alphabet are
 * being preloaded — can race that initialisation. The loser throws, and a
 * throw in a background load is invisible: a battleground that never appeared,
 * with nothing on screen to say why.
 *
 * So initialisation happens once, everything waits on the same promise, and a
 * failure is reported rather than swallowed.
 */

let started: Promise<void> | null = null;

export function prepareAssets(): Promise<void> {
  started ??= Assets.init({}).catch(() => {
    // Already initialised by something else, which is the outcome we want.
  });
  return started;
}

/** Whatever went wrong loading something, for the game to report. */
export type AssetFailure = (url: string, error: unknown) => void;

let onFailure: AssetFailure = (url, error) => {
  console.warn(`[assets] ${url} failed:`, error);
};

/** Lets the app send asset failures wherever it sends its other errors. */
export function reportAssetFailures(handler: AssetFailure): void {
  onFailure = handler;
}

/**
 * Loads a texture, waiting for the loader to be ready first.
 *
 * Returns null rather than throwing: every caller has something sensible to do
 * without the texture — a flat colour, a placeholder, no effect at all — and
 * none of them should take the game down over a missing picture.
 */
export async function loadTexture(url: string): Promise<Texture | null> {
  try {
    await prepareAssets();
    return await Assets.load<Texture>(url);
  } catch (error) {
    onFailure(url, error);
    return null;
  }
}
