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

/** Cuts a sentence at a word boundary, with an ellipsis if it had to. */
function trim(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export class HealthBar extends Container {
  private readonly fill = new Graphics();
  private readonly label: Text;
  private readonly amount: Text;
  /** The weapon and what its owner said they would do with it. */
  private readonly move: Text;
  /** A plate behind that caption, redrawn to whatever the caption needs. */
  private readonly movePlate = new Graphics();
  private readonly side: BarSide;
  /** Tweened rather than assigned, so the fill can be animated toward it. */
  private readonly value = { fraction: 1 };
  private tween: gsap.core.Tween | null = null;

  constructor(name: string, side: BarSide, colour: number = palette.mint) {
    super();
    this.side = side;

    // A soft panel behind the whole group. Ink on a pale sky is readable; the
    // same ink over a volcano is not, and the fight should not be legible only
    // on some battlegrounds.
    const panel = new Graphics();
    panel.beginFill(palette.cream, 0.72);
    panel.drawRoundedRect(-14, -46, BAR_WIDTH + 28, BAR_HEIGHT + 62, 24);
    panel.endFill();

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

    // Under the bar: the weapon chosen and the sentence written about it, so
    // the room can read what is about to happen while it happens.
    this.move = new Text('', {
      fontFamily: 'Verdana, Geneva, sans-serif',
      fontSize: 17,
      fill: palette.ink,
      wordWrap: true,
      wordWrapWidth: BAR_WIDTH,
      align: side === 'right' ? 'right' : 'left',
      lineHeight: 21,
    });
    this.move.y = BAR_HEIGHT + 14;
    this.move.alpha = 0;
    this.movePlate.alpha = 0;

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

    this.addChild(panel, track, this.fill, this.label, this.amount, this.movePlate, this.move);
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
   * Announces the weapon and the words behind it.
   *
   * Kept to two lines: this is a caption during a fight, not a transcript, and
   * fifty words at readable size would cover the fighter it belongs to.
   */
  setMove(weapon: string, prompt: string): void {
    const said = prompt.trim();
    this.move.text = said ? `${weapon} — “${trim(said, 90)}”` : weapon;

    // Squared up under the bar: hard against the outer edge on both sides, so
    // the caption and the name it belongs to line up rather than drifting.
    this.move.x = this.side === 'right' ? BAR_WIDTH - this.move.width : 0;

    // The plate is drawn to fit the caption rather than guessed at. The words
    // are a player's, so their length is not something this can assume — a
    // fixed panel left two lines of ink hanging over a photograph.
    const pad = 12;
    this.movePlate.clear();
    this.movePlate.beginFill(palette.cream, 0.78);
    this.movePlate.drawRoundedRect(
      this.move.x - pad,
      this.move.y - pad * 0.6,
      this.move.width + pad * 2,
      this.move.height + pad * 1.2,
      16,
    );
    this.movePlate.endFill();

    gsap.killTweensOf([this.move, this.movePlate]);
    for (const part of [this.movePlate, this.move]) {
      gsap.fromTo(part, { alpha: 0 }, { alpha: 1, duration: 0.3, ease: 'power2.out' });
    }
  }

  /** Clears it again between turns. */
  clearMove(): void {
    gsap.killTweensOf([this.move, this.movePlate]);
    gsap.to([this.move, this.movePlate], { alpha: 0, duration: 0.25 });
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
