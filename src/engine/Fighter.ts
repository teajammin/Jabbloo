import { Container, Sprite, Texture, Assets } from 'pixi.js';
import { Limb } from './Limb';
import { sampleDominantColour } from './colour';
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
 *    +- limbs     procedural leg and arm, drawn behind the body
 *    +- body      the character PNG; squashed/rotated by body primitives
 *    +- hand      sits at the anchor point; weapon primitives rotate THIS
 *        +- weapon    the weapon PNG
 *
 * The separate `hand` pivot is what lets a weapon swing or spin independently
 * of the body while still travelling with it — rotating `hand` sweeps the
 * weapon through an arc around the grip rather than around its own centre.
 *
 * Limbs sit behind the body so they appear to emerge from the character
 * rather than being pasted on top of the drawing.
 */
export class Fighter {
  readonly root = new Container();
  readonly limbs = new Container();
  readonly body = new Container();
  readonly hand = new Container();

  /** Procedural limbs, hidden until a melee move extends them. */
  leg!: Limb;
  arm!: Limb;

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

    this.root.addChild(this.limbs);
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

    this.buildLimbs(characterTexture);
    this.positionHand();
    this.applyFacing();
  }

  /**
   * Creates the leg and arm, tinted to match the character's own artwork.
   *
   * Thickness scales with the sprite so a small character doesn't get
   * comically thick limbs and a large one doesn't get spindly ones.
   */
  private buildLimbs(characterTexture: Texture): void {
    const colour = sampleDominantColour(characterTexture);
    const scale = this.targetHeight / 320;

    this.leg = new Limb(colour, 24 * scale, 19 * scale);
    this.arm = new Limb(colour, 19 * scale, 15 * scale);

    const width = this.bodySprite.width;
    const height = this.bodySprite.height;

    // Leg from the lower body, arm from the upper — both offset forward so
    // they read as reaching toward the opponent.
    this.leg.view.position.set(width * 0.06, -height * 0.16);
    this.arm.view.position.set(width * 0.14, -height * 0.56);

    this.limbs.addChild(this.leg.view);
    this.limbs.addChild(this.arm.view);
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

  /** The weapon sprite, for primitives that animate it directly. */
  get weapon(): Sprite {
    return this.weaponSprite;
  }

  /**
   * Moves the weapon out of the hand and into another container, preserving its
   * on-screen position and rotation so there is no visual jump.
   *
   * `throw` needs this: a thrown weapon must travel in stage coordinates rather
   * than the fighter's, or it would drag along with the body that threw it.
   */
  detachWeapon(into: Container): void {
    if (this.weaponSprite.parent === into) return;
    const position = into.toLocal(this.weaponSprite.getGlobalPosition());
    // Undo the fighter's mirroring so a thrown weapon isn't double-flipped.
    const rotation = this.weaponSprite.rotation * (this._facing === 'left' ? -1 : 1);

    into.addChild(this.weaponSprite);
    this.weaponSprite.position.copyFrom(position);
    this.weaponSprite.rotation = rotation;
    this.weaponSprite.scale.x = Math.abs(this.weaponSprite.scale.x) *
      (this._facing === 'left' ? -1 : 1);
  }

  /**
   * Returns the fighter to a neutral pose: weapon in hand, no leftover
   * rotation, offset or squash from a previous move.
   *
   * Choreographies are played back-to-back, so every move must begin from a
   * known state or errors accumulate across a round.
   */
  resetPose(): void {
    this.reattachWeapon();
    this.leg.hide();
    this.arm.hide();
    this.body.position.set(0, 0);
    this.body.rotation = 0;
    this.body.scale.set(1, 1);
    this.hand.rotation = 0;
    this.hand.position.set(0, 0);
    this.positionHand();
  }

  /** Returns the weapon to the hand and clears any transform it picked up. */
  reattachWeapon(): void {
    this.hand.addChild(this.weaponSprite);
    this.weaponSprite.position.set(0, 0);
    this.weaponSprite.rotation = 0;
    this.weaponSprite.scale.x = Math.abs(this.weaponSprite.scale.x);
  }

  destroy(): void {
    this.leg.destroy();
    this.arm.destroy();
    this.root.destroy({ children: true });
  }
}
