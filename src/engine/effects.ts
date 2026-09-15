import gsap from 'gsap';
import { loadTexture, reportMissingAsset } from './assets';
import { Assets, Container, Sprite, Texture } from 'pixi.js';

/**
 * Visual effect sprites — projectiles, beams, shockwaves, summons, impacts.
 *
 * These are the vocabulary the generic primitives draw from: `projectile`,
 * `beam`, `shockwave` and `summon` all resolve to one of these textures, which
 * is what lets a small set of moves express an unbounded range of player ideas.
 */

export const EFFECT_KINDS = [
  // Projectiles
  'fire', 'sun', 'star', 'ice', 'heart', 'rock',
  'bullet', 'arrow', 'pebble', 'splash', 'bolt', 'banana',
  // Beams
  'beam', 'charge',
  // Shockwaves and weather
  'soundwave', 'shockring', 'wave',
  'wind', 'dust', 'smoke', 'stink', 'poop', 'rain', 'tornado', 'snowflake', 'leaf',
  // Summons: things that arrive from off screen
  'drone', 'meteor', 'anvil', 'piano',
  'bomb', 'safe', 'cheese', 'fish', 'fist', 'boot', 'pan', 'shield', 'clock', 'coin',
  // Impacts and accents: what a hit leaves behind
  'impact', 'sparkle', 'dizzy', 'whoosh',
  'stars', 'crack', 'slash', 'bubble', 'note', 'hearts',
  'confused', 'alert', 'sweat', 'kiss', 'slime', 'tooth', 'confetti',
] as const;

export type EffectKind = (typeof EFFECT_KINDS)[number];

const BASE_PATH = '/effects';

export function isEffectKind(value: unknown): value is EffectKind {
  return typeof value === 'string' && (EFFECT_KINDS as readonly string[]).includes(value);
}

export function effectUrl(kind: EffectKind): string {
  return `${BASE_PATH}/${kind}.png`;
}

/**
 * Loads every effect texture up front.
 *
 * Worth the one-time cost: an effect that streams in mid-swing would pop into
 * existence a few frames late and miss its own impact.
 */
export async function preloadEffects(): Promise<void> {
  await Promise.all(EFFECT_KINDS.map((kind) => loadTexture(effectUrl(kind))));
}

export interface SpawnOptions {
  x: number;
  y: number;
  /** Target height in pixels; width follows the sprite's aspect. */
  height?: number;
  rotation?: number;
  alpha?: number;
  /** Defaults to the sprite's centre. */
  anchorX?: number;
  anchorY?: number;
  flip?: boolean;
}

/**
 * Puts an effect on screen and hands it back for a primitive to animate.
 *
 * Synchronous by design — it reads from the texture cache filled by
 * `preloadEffects`, so a move never has to await mid-timeline.
 */
export function spawnEffect(
  layer: Container,
  kind: EffectKind,
  options: SpawnOptions,
): Sprite {
  /*
   * The cache, synchronously — every effect is preloaded before a fight starts
   * precisely so a move never has to await mid-timeline.
   *
   * An empty texture is a sprite nobody can see, which is the worst way for
   * this to fail: the move plays, the timing is right, the shake lands, and
   * the bullet simply is not there. So a miss says so rather than quietly
   * drawing nothing.
   */
  const url = effectUrl(kind);
  const texture = Assets.get<Texture>(url) ?? Texture.EMPTY;
  if (texture === Texture.EMPTY) {
    reportMissingAsset(url, new Error(`effect "${kind}" was not loaded`));
  }
  const sprite = new Sprite(texture);

  sprite.anchor.set(options.anchorX ?? 0.5, options.anchorY ?? 0.5);
  sprite.position.set(options.x, options.y);
  sprite.rotation = options.rotation ?? 0;
  sprite.alpha = options.alpha ?? 1;

  if (options.height && texture.height > 0) {
    sprite.scale.set(options.height / texture.height);
  }
  if (options.flip) sprite.scale.x *= -1;

  layer.addChild(sprite);
  return sprite;
}

/** Removes an effect and frees its display object. */
/**
 * Removes an effect sprite.
 *
 * Guarded because the callers are animation callbacks that can fire after the
 * stage has gone — a turn ending, a rematch, a player quitting mid-move — and
 * destroying a display object twice throws.
 */
export function despawnEffect(sprite: Sprite): void {
  if (sprite.destroyed) return;
  /*
   * Stop animating it before taking it away.
   *
   * An effect is usually moved by several tweens at once — across, up, down,
   * spinning — and it is destroyed by whichever of them finishes first. The
   * others are still in the same frame's render list, and writing a position
   * into a freed Pixi object throws from inside GSAP's own loop, where no
   * caller can catch it. That surfaced as "something went wrong" over a fight
   * that was otherwise going perfectly well.
   */
  gsap.killTweensOf([sprite, sprite.scale, sprite.position]);
  sprite.destroy();
}
