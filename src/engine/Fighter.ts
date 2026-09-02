import { Container, Sprite, Texture, Assets } from 'pixi.js';
import type { FighterOptions, HandAnchor, Facing } from './types';

const DEFAULT_ANCHOR: HandAnchor = { x: 0.42, y: 0.05 };
const DEFAULT_HEIGHT = 320;
const WEAPON_HEIGHT_RATIO = 0.55;

/**
 * A character sprite with a weapon attached at its hand anchor.
 *
 * Deliberately built as three nested containers:
 *
 *   root          moved by locomotion primitives (move_to, charge, jump)
 *    +- body      the character PNG; squashed/rotated by body primitives
 *    +- hand      sits at the anchor point; weapon primitives rotate THIS
 *        +- weapon    the weapon PNG
 *
 * The separate `hand` pivot is what lets a weapon swing or spin independently
 * of the body while still travelling with it — rotating `hand` sweeps the
 * weapon through an arc around the grip rather than around its own centre.
 */
export class Fighter {
  readonly root = new Container();
  readonly body = new Container();
  readonly hand = new Container();

  readonly name: string;
  readonly weaponName: string;

  private bodySprite!: Sprite;
  private weaponSprite!: Sprite;
  private _facing: Facing;
  private readonly anchor: HandAnchor;
  private readonly targetHeight: number;
  private readonly targetWeaponHeight: number;

  private constructor(options: FighterOptions) {
    this.name = options.name ?? 'Fighter';
    this.weaponName = options.weaponName ?? 'Weapon';
    this.anchor = options.handAnchor ?? DEFAULT_ANCHOR;
    this.targetHeight = options.height ?? DEFAULT_HEIGHT;
    this.targetWeaponHeight =
      options.weaponHeight ?? this.targetHeight * WEAPON_HEIGHT_RATIO;
    this._facing = options.facing ?? 'right';

    this.root.addChild(this.body);
    this.root.addChild(this.hand);
  }

  /**
   * Loads textures and builds the fighter.
   * Async because player-drawn PNGs arrive over the network.
   */
  static async create(options: FighterOptions): Promise<Fighter> {
    const fighter = new Fighter(options);
    const [characterTexture, weaponTexture] = await Promise.all([
      Assets.load<Texture>(options.character),
      Assets.load<Texture>(options.weapon),
    ]);
    fighter.build(characterTexture, weaponTexture);
    return fighter;
  }

  private build(characterTexture: Texture, weaponTexture: Texture): void {
    this.bodySprite = new Sprite(characterTexture);
    // Anchored at bottom-centre so the fighter stands ON the ground line —
    // makes jump/slam maths behave regardless of sprite dimensions.
    this.bodySprite.anchor.set(0.5, 1);
    this.bodySprite.scale.set(this.targetHeight / characterTexture.height);
    this.body.addChild(this.bodySprite);

    this.weaponSprite = new Sprite(weaponTexture);
    // Anchored near the grip end, so rotation pivots where a hand would hold it.
    this.weaponSprite.anchor.set(0.5, 0.85);
    this.weaponSprite.scale.set(this.targetWeaponHeight / weaponTexture.height);
    this.hand.addChild(this.weaponSprite);

    this.positionHand();
    this.applyFacing();
  }

  /** Places the hand container at the anchor offset from the body's centre. */
  private positionHand(): void {
    const bodyWidth = this.bodySprite.width;
    const bodyHeight = this.bodySprite.height;
    // Body is bottom-anchored, so its visual centre is half a height up.
    this.hand.x = (bodyWidth / 2) * this.anchor.x;
    this.hand.y = -bodyHeight / 2 + (bodyHeight / 2) * this.anchor.y;
  }

  get facing(): Facing {
    return this._facing;
  }

  set facing(value: Facing) {
    if (this._facing === value) return;
    this._facing = value;
    this.applyFacing();
  }

  /**
   * Mirrors the whole fighter. Scaling `root` rather than the sprites keeps
   * the hand anchor correct automatically — it flips along with everything else.
   */
  private applyFacing(): void {
    this.root.scale.x = this._facing === 'right' ? 1 : -1;
  }

  /** Places the fighter's feet at a point. */
  setPosition(x: number, y: number): void {
    this.root.x = x;
    this.root.y = y;
  }

  /** Width of the character in stage pixels — used for spacing and collisions. */
  get width(): number {
    return this.bodySprite.width;
  }

  get height(): number {
    return this.bodySprite.height;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
