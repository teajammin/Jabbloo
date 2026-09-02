/**
 * Public types for the battle animation engine.
 *
 * The engine is standalone: it knows about sprites, anchors and a canvas.
 * It knows nothing about rooms, players, scoring or networking.
 */

import type { BattlegroundId } from './theme';

/** Which way a fighter faces. Fighters on the left face right, and vice versa. */
export type Facing = 'left' | 'right';

/** Which side of the stage a fighter stands on. */
export type Side = 'left' | 'right';

/**
 * Where a weapon attaches to a character, as a fraction of the character
 * sprite's size measured from its centre.
 *
 *   { x: 0, y: 0 }      dead centre of the character
 *   { x: 0.4, y: 0.1 }  40% of half-width to the right, slightly below centre
 *
 * Fractions rather than pixels so the anchor survives sprite rescaling —
 * player drawings arrive at wildly different resolutions.
 */
export interface HandAnchor {
  x: number;
  y: number;
}

export interface FighterOptions {
  /** Loaded texture or a URL the engine will load. */
  character: string;
  weapon: string;
  /** Display name — used later by the battle UI. */
  name?: string;
  weaponName?: string;
  /** Defaults to { x: 0.42, y: 0.05 }. */
  handAnchor?: HandAnchor;
  /** Target height in pixels. The sprite scales to this, preserving aspect. */
  height?: number;
  /** Weapon height in pixels. Defaults to 55% of the character height. */
  weaponHeight?: number;
  facing?: Facing;
}

export interface BattleStageOptions {
  /** Element the canvas mounts into. */
  parent: HTMLElement;
  /** Logical design size. The canvas scales to fit its parent. */
  width?: number;
  height?: number;
  battleground?: BattlegroundId;
  /** Pass false in tests / headless environments. */
  antialias?: boolean;
}

/** Where a fighter's feet sit, as a fraction of stage height. */
export const GROUND_Y = 0.82;
