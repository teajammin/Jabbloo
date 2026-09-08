import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import gsap from 'gsap';
import { battlegrounds, getBattleground, palette } from './theme';
import { GROUND_Y, type BattleStageOptions, type Side } from './types';
import type { BattlegroundId } from './theme';
import type { Fighter } from './Fighter';
import { BubbleText } from './BubbleText';
import { HealthBar } from './HealthBar';

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

/** How far in from each edge fighters stand, as a fraction of stage width. */
const SPAWN_INSET = 0.24;

/**
 * The battle canvas.
 *
 * Owns the Pixi application and the scene graph. Layers are separated so that
 * later primitives have somewhere sensible to act:
 *
 *   backdrop   battleground fill — never moves
 *   world      everything shakeable; shake_screen offsets THIS, not the canvas
 *    +- ground     floor line
 *    +- fighters   the combatants
 *    +- effects    projectiles, beams, impacts — drawn over the fighters
 *   overlay    future UI (health bars, damage numbers) — immune to shake
 */
export class BattleStage {
  readonly app: Application;
  readonly world = new Container();
  readonly fighters = new Container();
  /** Where projectiles, beams and impacts live. Above fighters, below UI. */
  readonly effects = new Container();
  readonly overlay = new Container();

  private readonly backdrop = new Graphics();
  /** The battleground photograph, behind everything and covering the stage. */
  private readonly scene = new Sprite(Texture.EMPTY);
  private readonly ground = new Graphics();
  private readonly parent: HTMLElement;
  /** Which side each fighter was placed on, so the stage can restore them. */
  private readonly sides = new Map<Fighter, Side>();
  private currentBattleground: BattlegroundId;
  private readonly resizeObserver: ResizeObserver;

  readonly width: number;
  readonly height: number;
  /** Set on teardown, so a photograph arriving late does not touch a dead stage. */
  private destroyed = false;

  constructor(options: BattleStageOptions) {
    this.parent = options.parent;
    this.width = options.width ?? DESIGN_WIDTH;
    this.height = options.height ?? DESIGN_HEIGHT;
    this.currentBattleground = options.battleground ?? battlegrounds[0].id;

    this.app = new Application({
      width: this.width,
      height: this.height,
      antialias: options.antialias ?? true,
      backgroundColor: palette.cream,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    this.parent.appendChild(this.app.view as HTMLCanvasElement);

    this.world.addChild(this.backdrop);
    this.world.addChild(this.scene);
    this.world.addChild(this.ground);
    this.world.addChild(this.fighters);
    this.world.addChild(this.effects);
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.overlay);

    this.drawBackdrop();

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.parent);
    this.fit();
  }

  /** Repaints the battleground and the ground line. */
  private drawBackdrop(): void {
    const ground = getBattleground(this.currentBattleground);

    // Painted first and kept underneath: it is what the stage looks like
    // before the photograph has loaded, and what it falls back to if the
    // photograph never does.
    this.backdrop.clear();
    this.backdrop.beginFill(ground.colour);
    this.backdrop.drawRect(0, 0, this.width, this.height);
    this.backdrop.endFill();

    void this.loadScene(ground.image);

    // A soft darker band for the floor, so fighters read as standing on something.
    const groundY = this.height * GROUND_Y;
    this.ground.clear();
    this.ground.beginFill(palette.ink, 0.07);
    this.ground.drawRoundedRect(
      -40,
      groundY,
      this.width + 80,
      this.height - groundY + 40,
      48,
    );
    this.ground.endFill();
  }

  /**
   * Fits the battleground photograph over the stage.
   *
   * Cover rather than stretch: a photograph squashed to 16:9 looks wrong in a
   * way nobody can name but everybody sees.
   */
  private async loadScene(url: string): Promise<void> {
    try {
      const texture = await Assets.load<Texture>(url);
      if (this.destroyed) return;
      this.scene.texture = texture;
      const scale = Math.max(this.width / texture.width, this.height / texture.height);
      this.scene.scale.set(scale);
      this.scene.x = (this.width - texture.width * scale) / 2;
      this.scene.y = (this.height - texture.height * scale) / 2;
    } catch {
      // The flat colour underneath is a perfectly good battleground.
    }
  }

  setBattleground(id: BattlegroundId): void {
    this.currentBattleground = id;
    this.drawBackdrop();
  }

  /**
   * Adds a fighter and stands them on their side of the stage,
   * automatically facing their opponent.
   */
  /**
   * Puts a health bar on the overlay for one side.
   *
   * The stage owns the placement because it owns the margins; the bar itself
   * only knows how to draw and animate, which keeps it usable anywhere.
   */
  addHealthBar(bar: HealthBar, side: Side): void {
    const margin = this.width * 0.045;
    bar.x = side === 'left' ? margin : this.width - margin - HealthBar.width;
    bar.y = this.height * 0.085;
    this.overlay.addChild(bar);
  }

  /** Clears the overlay's bars between turns, when the fighters change. */
  clearHealthBars(): void {
    for (const child of [...this.overlay.children]) {
      if (child instanceof HealthBar) child.destroy();
    }
  }

  /**
   * The damage a hit did, thrown up over the fighter who took it.
   *
   * On the world layer, not the overlay: it belongs to a place on the stage
   * rather than to the screen, and it should ride the screen shake that the
   * same hit causes.
   */
  showDamage(fighter: Fighter, amount: number): void {
    if (amount <= 0) return;

    const text = new Text(`-${Math.round(amount)}`, {
      fontFamily: 'Verdana, Geneva, sans-serif',
      fontSize: 58,
      fontWeight: 'bold',
      fill: palette.coral,
      stroke: palette.cream,
      strokeThickness: 8,
    });
    text.anchor.set(0.5, 1);
    text.x = fighter.root.x;
    text.y = fighter.root.y - fighter.height - 14;
    this.effects.addChild(text);

    const tl = gsap.timeline();
    // Punched up and out: big first, then settling as it rises, the way a
    // fighting game reads a hit at a glance.
    tl.fromTo(text.scale, { x: 0.4, y: 0.4 }, { x: 1.15, y: 1.15, duration: 0.18, ease: 'back.out(3)' });
    tl.to(text.scale, { x: 1, y: 1, duration: 0.12 });
    tl.to(text, { y: text.y - 90, duration: 1.1, ease: 'power2.out' }, 0);
    tl.to(text, { alpha: 0, duration: 0.4, ease: 'power2.in' }, 0.7);
    tl.eventCallback('onComplete', () => { if (!text.destroyed) text.destroy(); });
  }

  /**
   * Announces a fighter by name, in the game's own lettering.
   *
   * The brief asks for a reveal rather than two sprites simply being present:
   * a name big on the screen, one fighter at a time. It sits on the overlay so
   * the entrance can shake the world underneath it without the name wobbling.
   */
  async announce(name: string, side: Side, seconds = 1.6): Promise<void> {
    const text = await BubbleText.create(name.toUpperCase().slice(0, 18), {
      height: this.height * 0.16,
      jitter: 4,
    });

    // Shrunk to fit before it is placed. A name is as long as a player made it,
    // and lettering sized for a short one runs off both edges of the screen on
    // a long one — which is what "NAMELESS" did.
    const room = this.width * 0.86;
    if (text.width > room) text.scale.set(room / text.width);

    // Centred over the half of the stage the fighter is walking onto, so the
    // name and the character arrive in the same place — but never so far over
    // that it leaves the screen.
    const margin = this.width * 0.04;
    const wanted = this.homeX(side) - text.width / 2;
    text.x = Math.max(margin, Math.min(this.width - margin - text.width, wanted));
    text.y = this.height * 0.24;
    text.alpha = 0;
    const full = text.scale.x;
    this.overlay.addChild(text);

    // Deliberately plain: a fade and a small rise. The bouncing scale it had
    // before animated dozens of letter sprites at once through an easing curve
    // that overshoots, which on a laptop driving a WebGL canvas stuttered — and
    // a stuttering title reads as the game struggling rather than as a flourish.
    const tl = gsap.timeline();
    text.y += 18;
    text.scale.set(full);
    tl.to(text, { alpha: 1, y: text.y - 18, duration: 0.3, ease: 'power2.out' });
    tl.to(text, { alpha: 0, duration: 0.28 }, `+=${Math.max(0.1, seconds - 0.6)}`);

    await new Promise<void>((resolve) => {
      tl.eventCallback('onComplete', () => {
        // The stage may have been torn down while this was on screen — a turn
        // ending, a rematch, a player quitting — and destroying a display
        // object twice throws.
        if (!text.destroyed) text.destroy({ children: true });
        resolve();
      });
    });
  }

  /**
   * Walks a fighter on from the wings.
   *
   * The brief asks for a grand entrance, and there is a practical reason for
   * one beyond the flourish: it gives the crowd a beat to see who is fighting
   * before the first move plays, which otherwise arrives on a stage that
   * simply blinked into existence.
   *
   * Resolves when the fighter is home and settled.
   */
  enterStage(fighter: Fighter, side: Side): Promise<void> {
    const home = this.homeX(side);
    const ground = this.height * GROUND_Y;
    fighter.setPosition(this.offstageX(side), ground);

    const tl = gsap.timeline();
    // Two hops in rather than a slide: a slide reads as the sprite being
    // dragged, hops read as the character arriving under its own power.
    tl.to(fighter.root, { x: home, duration: 0.9, ease: 'power2.out' });
    for (const at of [0, 0.32]) {
      tl.to(fighter.root, { y: ground - 90, duration: 0.24, ease: 'power2.out' }, at);
      tl.to(fighter.root, { y: ground, duration: 0.26, ease: 'power2.in' }, at + 0.24);
      tl.to(fighter.body, { scaleY: 0.88, scaleX: 1.1, duration: 0.1 }, at + 0.5);
      tl.to(fighter.body, { scaleY: 1, scaleX: 1, duration: 0.14 }, at + 0.6);
    }
    // A flourish of the weapon to finish, so the thing they drew gets a look.
    tl.to(fighter.hand, { rotation: -0.9, duration: 0.18, ease: 'power2.out' }, 0.95);
    tl.to(fighter.hand, { rotation: 0, duration: 0.3, ease: 'elastic.out(1, 0.5)' });

    return new Promise((resolve) => { tl.eventCallback('onComplete', () => resolve()); });
  }

  addFighter(fighter: Fighter, side: Side): void {
    this.sides.set(fighter, side);
    this.place(fighter, side);
    this.fighters.addChild(fighter.root);
  }

  removeFighter(fighter: Fighter): void {
    this.sides.delete(fighter);
    this.fighters.removeChild(fighter.root);
  }

  /** Where a fighter stands when they are not moving. */
  homeX(side: Side): number {
    return side === 'left' ? this.width * SPAWN_INSET : this.width * (1 - SPAWN_INSET);
  }

  /** Just off the edge they come on from, and go back to when beaten. */
  offstageX(side: Side): number {
    return side === 'left' ? -this.width * 0.2 : this.width * 1.2;
  }

  private place(fighter: Fighter, side: Side): void {
    const x = this.homeX(side);
    fighter.setPosition(x, this.height * GROUND_Y);
    fighter.facing = side === 'left' ? 'right' : 'left';
  }

  /**
   * Restores the opening tableau: everyone back on their mark in a neutral
   * pose, and any screen shake offset cleared.
   */
  reset(): void {
    this.world.position.set(0, 0);
    this.effects.removeChildren().forEach((child) => child.destroy());
    for (const [fighter, side] of this.sides) {
      fighter.resetPose();
      this.place(fighter, side);
    }
  }

  /** The fighters currently on stage, in insertion order. */
  get roster(): Fighter[] {
    return [...this.sides.keys()];
  }

  /**
   * Letterbox-scales the canvas to fill its parent while preserving aspect.
   * The logical coordinate space stays fixed, so choreography written against
   * a 1280x720 stage plays identically on a phone and a projector.
   */
  private fit(): void {
    const { clientWidth, clientHeight } = this.parent;
    if (!clientWidth || !clientHeight) return;

    const scale = Math.min(clientWidth / this.width, clientHeight / this.height);
    const view = this.app.view as HTMLCanvasElement;
    view.style.width = `${Math.round(this.width * scale)}px`;
    view.style.height = `${Math.round(this.height * scale)}px`;
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.app.destroy(true, { children: true });
  }
}
