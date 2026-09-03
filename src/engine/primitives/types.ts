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
}

export type PrimitiveName = keyof PrimitiveParams;

export type Primitive<N extends PrimitiveName> = (
  ctx: PrimitiveContext,
  params: PrimitiveParams[N],
) => gsap.core.Timeline;

/** A single step in a choreography. */
export type Step = {
  [N in PrimitiveName]: { move: N; params?: PrimitiveParams[N] };
}[PrimitiveName];
