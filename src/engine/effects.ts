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
  // Beams
  'beam', 'charge',
  // Shockwaves
  'soundwave', 'shockring', 'wave',
  // Summons
  'drone', 'meteor', 'anvil', 'piano',
  // Impacts and accents
  'impact', 'sparkle', 'dizzy', 'whoosh',
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
  await Promise.all(EFFECT_KINDS.map((kind) => Assets.load<Texture>(effectUrl(kind))));
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
  const texture = Assets.get<Texture>(effectUrl(kind)) ?? Texture.EMPTY;
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
export function despawnEffect(sprite: Sprite): void {
  sprite.destroy();
}
