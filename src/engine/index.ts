/**
 * Battle animation engine — public API.
 *
 * Consumers import from here and nothing deeper. Everything below this file is
 * an implementation detail and free to change.
 *
 * Currently exposes the stage, the sprite rig, bubble lettering, the animation
 * primitive library, and choreography playback. The AI backend lands next.
 */

export { BattleStage } from './BattleStage';
export { Fighter } from './Fighter';
export { BubbleText, type BubbleTextOptions } from './BubbleText';
export {
  palette,
  battlegrounds,
  getBattleground,
  toCss,
  shape,
  type BattlegroundId,
  type PaletteColour,
} from './theme';
export {
  GROUND_Y,
  type BattleStageOptions,
  type FighterOptions,
  type HandAnchor,
  type Facing,
  type Side,
} from './types';
export {
  primitives,
  createStep,
  isPrimitiveName,
  PRIMITIVE_NAMES,
  DURATION_MIN,
  DURATION_MAX,
  type PrimitiveContext,
  type PrimitiveName,
  type PrimitiveParams,
  type Step,
  type SwingDirection,
} from './primitives';
export {
  playChoreography,
  parseChoreography,
  DEFAULT_CHOREOGRAPHY,
  MAX_CHOREOGRAPHY_SECONDS,
  MAX_STEPS,
  type Choreography,
  type Playback,
  type PlaybackOptions,
} from './player';
