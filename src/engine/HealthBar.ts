import { Container, Graphics, Text } from 'pixi.js';
import gsap from 'gsap';
import { palette } from './theme';

/**
 * A fighter's health, on the stage overlay.
 *
 * Lives in `overlay` rather than `world` so a screen shake rattles the fight
 * and not the numbers — a bar that jitters is hard to read at exactly the
 * moment a player wants to read it.
 *
 * The fill is tweened rather than set, because damage arriving as a jump from
 * 100 to 67 reads as a rendering glitch; the same change over half a second
 * reads as a hit landing.
 */

const BAR_WIDTH = 380;
const BAR_HEIGHT = 34;
const RADIUS = BAR_HEIGHT / 2;
const OUTLINE = 5;

export type BarSide = 'left' | 'right';

export class HealthBar extends Container {
  private readonly fill = new Graphics();
  private readonly label: Text;
  private readonly amount: Text;
  private readonly side: BarSide;
  /** Tweened rather than assigned, so the fill can be animated toward it. */
  private readonly value = { fraction: 1 };
  private tween: gsap.core.Tween | null = null;

  constructor(name: string, side: BarSide, colour: number = palette.mint) {
    super();
    this.side = side;

    const track = new Graphics();
    track.beginFill(palette.ink, 0.16);
    track.drawRoundedRect(0, 0, BAR_WIDTH, BAR_HEIGHT, RADIUS);
    track.endFill();
    // Drawn as a second, inset rounded rect rather than a line style, so the
    // outline keeps its thickness at every stage scale.
    track.lineStyle({ width: OUTLINE, color: palette.ink, alpha: 0.75, alignment: 0 });
    track.drawRoundedRect(0, 0, BAR_WIDTH, BAR_HEIGHT, RADIUS);

    this.fill.beginFill(colour);
    this.fill.drawRoundedRect(0, 0, BAR_WIDTH, BAR_HEIGHT, RADIUS);
    this.fill.endFill();

    this.label = new Text(name.toUpperCase(), {
      fontFamily: 'Verdana, Geneva, sans-serif',
      fontSize: 24,
      fontWeight: 'bold',
      fill: palette.ink,
      letterSpacing: 1,
    });
    this.amount = new Text('100', {
      fontFamily: 'Verdana, Geneva, sans-serif',
      fontSize: 22,
      fontWeight: 'bold',
      fill: palette.ink,
    });

    // A long name must not run into the number at the other end.
    const maxLabel = BAR_WIDTH * 0.62;
    if (this.label.width > maxLabel) this.label.scale.set(maxLabel / this.label.width);

    this.label.y = -this.label.height - 6;
    this.amount.y = this.label.y;

    // The right-hand bar mirrors its layout so both read outward from the
    // middle of the screen, the way a fighting game arranges them.
    if (side === 'right') {
      this.fill.pivot.x = BAR_WIDTH;
      this.fill.x = BAR_WIDTH;
    }

    this.addChild(track, this.fill, this.label, this.amount);
    this.layoutText();
    this.redraw();
  }

  /**
   * Puts the name at the bar's outer end and the number at its inner one.
   *
   * Re-run whenever the number changes, because it is right-aligned on the
   * left-hand bar and its width changes with the digit count — laying it out
   * once left 100 sitting on top of the name.
   */
  private layoutText(): void {
    if (this.side === 'left') {
      this.label.x = 0;
      this.amount.x = BAR_WIDTH - this.amount.width;
    } else {
      this.label.x = BAR_WIDTH - this.label.width;
      this.amount.x = 0;
    }
  }

  /**
   * Moves the bar to a new health value.
   *
   * `max` is a parameter rather than a constant so the engine never has to
   * know the game's starting health.
   */
  setHealth(health: number, max: number, animated = true): void {
    const target = max > 0 ? Math.max(0, Math.min(1, health / max)) : 0;
    this.amount.text = String(Math.max(0, Math.round(health)));
    this.layoutText();

    this.tween?.kill();
    if (!animated) {
      this.value.fraction = target;
      this.redraw();
      return;
    }

    this.tween = gsap.to(this.value, {
      fraction: target,
      duration: 0.55,
      ease: 'power2.out',
      onUpdate: () => this.redraw(),
    });
  }

  /** Scales the fill horizontally; drawing it once and squashing is cheaper
   *  than redrawing rounded geometry every frame. */
  private redraw(): void {
    this.fill.scale.x = Math.max(0.0001, this.value.fraction);
    this.fill.alpha = this.value.fraction <= 0.0001 ? 0 : 1;
  }

  destroy(): void {
    this.tween?.kill();
    super.destroy({ children: true });
  }

  static get width(): number {
    return BAR_WIDTH;
  }
}
