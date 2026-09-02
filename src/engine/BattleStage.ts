import { Application, Container, Graphics } from 'pixi.js';
import { getBattleground, palette } from './theme';
import { GROUND_Y, type BattleStageOptions, type Side } from './types';
import type { BattlegroundId } from './theme';
import type { Fighter } from './Fighter';

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
 *   overlay    future UI (health bars, damage numbers) — immune to shake
 */
export class BattleStage {
  readonly app: Application;
  readonly world = new Container();
  readonly fighters = new Container();
  readonly overlay = new Container();

  private readonly backdrop = new Graphics();
  private readonly ground = new Graphics();
  private readonly parent: HTMLElement;
  private currentBattleground: BattlegroundId;
  private readonly resizeObserver: ResizeObserver;

  readonly width: number;
  readonly height: number;

  constructor(options: BattleStageOptions) {
    this.parent = options.parent;
    this.width = options.width ?? DESIGN_WIDTH;
    this.height = options.height ?? DESIGN_HEIGHT;
    this.currentBattleground = options.battleground ?? 'meadow';

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
    this.world.addChild(this.ground);
    this.world.addChild(this.fighters);
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.overlay);

    this.drawBackdrop();

    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.parent);
    this.fit();
  }

  /** Repaints the battleground fill and the ground line. */
  private drawBackdrop(): void {
    const { colour } = getBattleground(this.currentBattleground);

    this.backdrop.clear();
    this.backdrop.beginFill(colour);
    this.backdrop.drawRect(0, 0, this.width, this.height);
    this.backdrop.endFill();

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

  setBattleground(id: BattlegroundId): void {
    this.currentBattleground = id;
    this.drawBackdrop();
  }

  /**
   * Adds a fighter and stands them on their side of the stage,
   * automatically facing their opponent.
   */
  addFighter(fighter: Fighter, side: Side): void {
    const x =
      side === 'left' ? this.width * SPAWN_INSET : this.width * (1 - SPAWN_INSET);
    fighter.setPosition(x, this.height * GROUND_Y);
    fighter.facing = side === 'left' ? 'right' : 'left';
    this.fighters.addChild(fighter.root);
  }

  removeFighter(fighter: Fighter): void {
    this.fighters.removeChild(fighter.root);
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
    this.resizeObserver.disconnect();
    this.app.destroy(true, { children: true });
  }
}
