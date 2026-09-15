import { Container, Sprite, Texture } from 'pixi.js';
import { loadTexture } from './assets';
import { gripFor, DEFAULT_GRIP, type Grip } from './grip';
import gsap from 'gsap';
import { Limb } from './Limb';
import { sampleDominantColour } from './colour';
import { detectLimbs, silhouetteOf } from './limbs';
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
  /**
   * Everything that squashes and stretches.
   *
   * Given `scaleX` and `scaleY` of its own below — see `understandScale`.
   */
  readonly body = new Container();
  readonly hand = new Container();

  /** Procedural limbs, hidden until a melee move extends them. */
  leg!: Limb;
  arm!: Limb;

  readonly name: string;
  readonly weaponName: string;
  private heldWeaponName: string;

  private bodySprite!: Sprite;
  private weaponSprite!: Sprite;
  private _facing: Facing;
  /** Not readonly: limb detection can move it onto a hand the player drew. */
  private anchor: HandAnchor;
  private readonly targetHeight: number;
  private readonly targetWeaponHeight: number;

  /** Whether the character came with limbs of its own. */
  private drawnLimbs = { arms: false, legs: false };
  /** How the weapon in hand is held, as measured from its own drawing. */
  private grip: Grip = DEFAULT_GRIP;
  /** True when the caller pinned the anchor and detection must not move it. */
  private readonly anchorGiven: boolean;

  private constructor(options: FighterOptions) {
    this.name = options.name ?? 'Fighter';
    this.weaponName = options.weaponName ?? 'Weapon';
    this.heldWeaponName = this.weaponName;
    this.anchorGiven = options.handAnchor !== undefined;
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
      loadTexture(options.character),
      loadTexture(options.weapon),
    ]);
    // A fighter with no picture still fights: an empty texture draws nothing,
    // and the rig, the limbs and the weapon arm all carry on regardless.
    fighter.build(characterTexture ?? Texture.EMPTY, weaponTexture ?? Texture.EMPTY);
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
    // Empty-handed until a weapon is chosen for the turn. A fighter holding
    // something before anyone picked it is showing a weapon nobody chose.
    this.weaponSprite.visible = false;
    // Anchored near the grip end, so rotation pivots where a hand would hold it.
    this.weaponSprite.anchor.set(0.5, 0.85);
    this.weaponSprite.scale.set(this.targetWeaponHeight / weaponTexture.height);
    // Before anything animates it.
    Fighter.understandScale(this.body);

    this.holdProperly(weaponTexture);
    this.hand.addChild(this.weaponSprite);

    this.buildLimbs(characterTexture);
    this.useDrawnLimbs(characterTexture);
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

  /**
   * Defers to whatever the player actually drew.
   *
   * A character with arms gets the weapon put in its own hand and no second
   * arm drawn over the top; one with legs keeps them and loses the procedural
   * kick. A bean with neither is unaffected, which is the case the procedural
   * limbs were built for in the first place.
   */
  private useDrawnLimbs(characterTexture: Texture): void {
    const found = detectLimbs(silhouetteOf(characterTexture));
    this.drawnLimbs = { arms: found.arms, legs: found.legs };

    if (found.arms) this.arm.suppress();
    if (found.legs) this.leg.suppress();
    // An explicit anchor from the caller wins: it was a decision, and this is
    // a guess.
    if (found.hand && !this.anchorGiven) this.anchor = found.hand;
  }

  /** What the drawing brought with it, for anything that wants to know. */
  get ownLimbs(): { arms: boolean; legs: boolean } {
    return { ...this.drawnLimbs };
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

  /**
   * Swaps the held weapon.
   *
   * A fighter is built with one weapon but a player picks a different one each
   * turn, and rebuilding the whole fighter would lose their position on stage
   * and restart the entrance.
   */
  async setWeapon(url: string, name?: string): Promise<void> {
    const texture = await loadTexture(url);
    if (!texture) return;
    this.weaponSprite.texture = texture;
    this.weaponSprite.scale.set(this.targetWeaponHeight / texture.height);
    // Each weapon is held its own way, so this is worked out per swap rather
    // than once when the fighter was built.
    this.holdProperly(texture);
    // Facing is applied by mirroring the root, so the sprite's own sign has to
    // be reset or a swap mid-fight can leave the new weapon back to front.
    this.weaponSprite.scale.x = Math.abs(this.weaponSprite.scale.x);
    if (name !== undefined) this.heldWeaponName = name;
  }

  /**
   * Takes hold of a weapon the way it was drawn to be held.
   *
   * A player draws a sword pointing up, an axe pointing left, a baguette flat.
   * The rig used to hold all of them by the middle of the bottom edge and swing
   * whichever way the drawing happened to face, which reads as a mis-rig in a
   * way nobody can name but everybody sees.
   *
   * The measurement is only followed when it is sure. On a weapon with no
   * obvious handle — a shield, a ball, a cloud — the drawing is left exactly as
   * the player made it, because a confident wrong answer is worse than the
   * plain one.
   */
  private holdProperly(texture: Texture): void {
    const grip = gripFor(texture);
    this.grip = grip;

    if (grip.confidence < 0.35) {
      this.weaponSprite.anchor.set(DEFAULT_GRIP.x, DEFAULT_GRIP.y);
      this.weaponSprite.rotation = 0;
      return;
    }

    // The anchor is where the hand is, so the weapon turns about its handle
    // rather than about its middle.
    this.weaponSprite.anchor.set(grip.x, grip.y);
    this.weaponSprite.rotation = grip.rotation;
  }

  /**
   * Teaches a display object to understand `scaleX` and `scaleY`.
   *
   * Pixi has `scale.x` and `scale.y`; `scaleX` is GSAP's Pixi plugin's
   * invention, and that plugin is not registered here. So every squash and
   * stretch written as `{ scaleX, scaleY }` — the anticipation before a swing,
   * the recoil after it, the wind-up on a shout — was quietly rejected by GSAP
   * as an unknown property and did nothing at all. Thirty-nine of them, across
   * the whole engine, animating nothing.
   *
   * Two accessors are a smaller and safer change than rewriting every one of
   * those call sites into a second tween on a different target, and they mean
   * the obvious spelling keeps working the next time somebody reaches for it.
   */
  private static understandScale(view: Container): void {
    if ('scaleX' in view) return;
    Object.defineProperties(view, {
      scaleX: {
        configurable: true,
        get(this: Container) { return this.scale.x; },
        set(this: Container, value: number) { this.scale.x = value; },
      },
      scaleY: {
        configurable: true,
        get(this: Container) { return this.scale.y; },
        set(this: Container, value: number) { this.scale.y = value; },
      },
    });
  }

  /** How the weapon in hand is being held, for anything that wants to know. */
  get weaponGrip(): Grip {
    return this.grip;
  }

  /**
   * Draws the weapon, and returns a timeline that presents it.
   *
   * Separate from `setWeapon` because swapping the texture and revealing it are
   * different moments: the swap happens as the move is prepared, the reveal is
   * part of the show.
   */
  revealWeapon(): gsap.core.Timeline {
    const tl = gsap.timeline();
    this.weaponSprite.visible = true;
    this.weaponSprite.alpha = 0;
    tl.to(this.weaponSprite, { alpha: 1, duration: 0.22, ease: 'power2.out' });
    tl.fromTo(this.hand, { rotation: -0.55 }, {
      rotation: 0, duration: 0.42, ease: 'back.out(2.2)',
    }, '<');
    return tl;
  }

  /** Puts the weapon away — between turns, nobody is holding anything. */
  holsterWeapon(): void {
    this.weaponSprite.visible = false;
  }

  /** The weapon currently held, which changes as a player picks per turn. */
  get currentWeaponName(): string {
    return this.heldWeaponName;
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
  /**
   * Colours the fighter, for a state that outlasts the blow that caused it.
   *
   * On the sprite rather than the container it sits in: a Pixi container has
   * no tint of its own in this version, so tinting "the body" means tinting
   * what the body is made of. White is the absence of a tint, which is why
   * clearing uses it.
   */
  setTint(colour: number): void {
    this.bodySprite.tint = colour;
  }

  /** What colour they currently are. White means nothing is wrong with them. */
  get tint(): number {
    // Pixi widens this to a ColorSource on read; everything here sets a number.
    return Number(this.bodySprite.tint);
  }

  resetPose(): void {
    // Whatever was done to them, it ends with the exchange.
    this.setTint(0xffffff);
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
    // Back to how this particular weapon is held, not to zero: zero is the
    // angle it happened to be drawn at, which is what the grip corrects.
    this.weaponSprite.rotation = this.grip.confidence >= 0.35 ? this.grip.rotation : 0;
    this.weaponSprite.scale.x = Math.abs(this.weaponSprite.scale.x);
  }

  destroy(): void {
    // Tweens outlive the thing they animate: an entrance or a half-played move
    // would go on writing positions into a destroyed sprite every frame.
    gsap.killTweensOf([
      this.root, this.body, this.hand, this.bodySprite, this.weaponSprite, this.limbs,
      this.root.scale, this.root.position,
      this.body.scale, this.body.position,
      this.hand.scale, this.hand.position,
      this.bodySprite.scale, this.weaponSprite.scale, this.weaponSprite.position,
    ]);
    this.leg.destroy();
    this.arm.destroy();
    this.root.destroy({ children: true });
  }
}
