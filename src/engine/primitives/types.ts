import type { Fighter } from '../Fighter';
import type { BattleStage } from '../BattleStage';

/**
 * Everything a primitive is allowed to touch.
 *
 * Primitives get the two fighters and the stage — nothing else. They do not
 * know about scoring, prompts, rounds or networking, which keeps them
 * reusable and trivially testable.
 */
export interface PrimitiveContext {
  /** The fighter performing the move. */
  actor: Fighter;
  /** Their opponent. Targeted moves aim here. */
  enemy: Fighter;
  stage: BattleStage;
}

export interface BaseParams {
  duration?: number;
}

export interface MoveToParams extends BaseParams {
  /** Horizontal destination as a fraction of stage width. */
  x?: number;
}

export interface ChargeParams extends BaseParams {
  target?: 'enemy';
}

export interface RecoilParams extends BaseParams {
  /** Knockback distance in pixels. */
  distance?: number;
}

export interface SpinWeaponParams extends BaseParams {
  rotations?: number;
}

export type SwingDirection = 'left' | 'right' | 'down' | 'up';

export interface SwingParams extends BaseParams {
  direction?: SwingDirection;
  /** Sweep of the arc in degrees. */
  arc?: number;
}

export interface SlamParams extends BaseParams {
  direction?: 'down' | 'forward';
}

export interface ThrowParams extends BaseParams {
  target?: 'enemy';
  returnAfter?: boolean;
}

export interface JumpParams extends BaseParams {
  height?: number;
  forward?: boolean;
}

export interface ShakeScreenParams extends BaseParams {
  /** 1 (barely perceptible) to 10 (teeth-rattling). */
  intensity?: number;
}

export type IdleParams = BaseParams;

// ------------------------------------------------------------------- melee

export interface KickParams extends BaseParams {
  style?: 'roundhouse' | 'front' | 'sweep';
}

export interface PunchParams extends BaseParams {
  style?: 'jab' | 'uppercut' | 'hook';
}

export type HeadbuttParams = BaseParams;
export type BiteParams = BaseParams;
export type LickParams = BaseParams;
export type GrabParams = BaseParams;
export type StompParams = BaseParams;

// -------------------------------------------------------------- acrobatics

export interface FlipParams extends BaseParams {
  rotations?: number;
  forward?: boolean;
}

export type HandspringParams = BaseParams;

export interface TeleportParams extends BaseParams {
  to?: 'behind' | 'above' | 'front';
}

export interface TauntParams extends BaseParams {
  style?: 'twerk' | 'dance' | 'point' | 'bow';
}

// ------------------------------------------------------------------ ranged

export interface ProjectileParams extends BaseParams {
  kind?: 'fire' | 'sun' | 'star' | 'ice' | 'heart' | 'rock';
  /** Height of the lob in pixels. 0 is a flat shot. */
  arc?: number;
  size?: number;
}

export interface BeamParams extends BaseParams {
  kind?: 'energy' | 'fire' | 'ice' | 'rainbow';
  /** How long the gather takes before firing. */
  chargeDuration?: number;
  thickness?: number;
}

export interface ShockwaveParams extends BaseParams {
  kind?: 'sound' | 'water' | 'ring';
  intensity?: number;
}

export interface SummonParams extends BaseParams {
  kind?: 'drone' | 'meteor' | 'anvil' | 'piano';
  size?: number;
}

// ----------------------------------------------------------------- special

export type InhaleParams = BaseParams;

export interface GrowParams extends BaseParams {
  scale?: number;
}

export interface ShrinkParams extends BaseParams {
  scale?: number;
}

export type KnockdownParams = BaseParams;
export type DizzyParams = BaseParams;

/** The complete set of moves a choreographer may call. */
export interface PrimitiveParams {
  move_to: MoveToParams;
  charge: ChargeParams;
  recoil: RecoilParams;
  spin_weapon: SpinWeaponParams;
  swing: SwingParams;
  slam: SlamParams;
  throw: ThrowParams;
  jump: JumpParams;
  shake_screen: ShakeScreenParams;
  idle: IdleParams;

  kick: KickParams;
  punch: PunchParams;
  headbutt: HeadbuttParams;
  bite: BiteParams;
  lick: LickParams;
  grab: GrabParams;
  stomp: StompParams;

  flip: FlipParams;
  handspring: HandspringParams;
  teleport: TeleportParams;
  taunt: TauntParams;

  projectile: ProjectileParams;
  beam: BeamParams;
  shockwave: ShockwaveParams;
  summon: SummonParams;

  inhale: InhaleParams;
  grow: GrowParams;
  shrink: ShrinkParams;
  knockdown: KnockdownParams;
  dizzy: DizzyParams;
}

/**
 * Who a step is performed by.
 *
 * `"enemy"` swaps the actor and opponent for that step, which is how a
 * choreography shows the opponent reacting — knocked flat, staggered, sucked
 * in — rather than only ever animating the attacker.
 */
export type Performer = 'self' | 'enemy';

export type PrimitiveName = keyof PrimitiveParams;

export type Primitive<N extends PrimitiveName> = (
  ctx: PrimitiveContext,
  params: PrimitiveParams[N],
) => gsap.core.Timeline;

/** A single step in a choreography. */
export type Step = {
  [N in PrimitiveName]: { move: N; on?: Performer; params?: PrimitiveParams[N] };
}[PrimitiveName];
