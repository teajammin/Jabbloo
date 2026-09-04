import { Graphics, LINE_CAP } from 'pixi.js';
import { darken } from './colour';

/**
 * A procedurally drawn limb.
 *
 * Player characters are single flat PNGs with no skeleton, so kicks and
 * punches have nothing to articulate. This draws a simple bubble limb — a
 * rounded capsule with a ball on the end — colour-sampled from the character
 * so it reads as part of the same drawing.
 *
 * Limbs are hidden by default and only appear for the duration of a melee
 * move, which keeps them from looking like a permanent mis-rig on characters
 * that already have legs drawn on.
 */
export class Limb {
  readonly view = new Graphics();

  /** Tweened by primitives; call `redraw()` after changing either. */
  angle = Math.PI / 2;
  length = 0;

  constructor(
    private readonly colour: number,
    private readonly thickness = 22,
    private readonly capRadius = 18,
  ) {
    this.view.visible = false;
  }

  /** Extends to `length` px at `angle` radians (0 = right, PI/2 = down). */
  set(angle: number, length: number): this {
    this.angle = angle;
    this.length = length;
    return this.redraw();
  }

  redraw(): this {
    const g = this.view;
    g.clear();

    if (this.length <= 1) return this;

    const x = Math.cos(this.angle) * this.length;
    const y = Math.sin(this.angle) * this.length;
    const outline = darken(this.colour, 0.6);

    // Outline pass, then fill, matching the bubble style of the artwork.
    g.lineStyle({ width: this.thickness + 10, color: outline, cap: LINE_CAP.ROUND });
    g.moveTo(0, 0).lineTo(x, y);
    g.lineStyle({ width: this.thickness, color: this.colour, cap: LINE_CAP.ROUND });
    g.moveTo(0, 0).lineTo(x, y);

    // Foot / fist
    g.lineStyle(0);
    g.beginFill(outline).drawCircle(x, y, this.capRadius + 5).endFill();
    g.beginFill(this.colour).drawCircle(x, y, this.capRadius).endFill();

    return this;
  }

  show(): this {
    this.view.visible = true;
    return this;
  }

  hide(): this {
    this.view.visible = false;
    this.length = 0;
    this.view.clear();
    return this;
  }

  destroy(): void {
    this.view.destroy();
  }
}
