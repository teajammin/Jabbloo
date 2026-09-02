/**
 * Battle animation engine — public API.
 *
 * Consumers import from here and nothing deeper. Everything below this file is
 * an implementation detail and free to change.
 *
 * Currently exposes stage + sprite rigging. Animation primitives and
 * `playChoreography()` land in the next task.
 */

export { BattleStage } from './BattleStage';
export { Fighter } from './Fighter';
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
