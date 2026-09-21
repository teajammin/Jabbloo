import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { loadTexture } from './assets';
import gsap from 'gsap';
import { battlegrounds, getBattleground, palette } from './theme';
import { GROUND_Y, type BattleStageOptions, type Side } from './types';
import type { BattlegroundId } from './theme';
import type { Fighter } from './Fighter';
import { BubbleText } from './BubbleText';
import { HealthBar } from './HealthBar';
import { spawnEffect } from './effects';
// The stage's own Side is which half a fighter stands on; this one is where
// on a body a blow is aimed. Two different questions, so two different names.
import type { Side as GuardSide } from '../shared/protocol';

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;

/**
 * How far past the edges the scenery is drawn.
 *
 * The screen shake moves the whole world, scenery included, and a photograph
 * cut exactly to the stage slid off its own edge and showed the blank stage
 * underneath — a white band along one side for a fifth of a second, every
 * time anything hit anything. The strongest shake is 30px on a 1280-wide
 * stage, so a twentieth over on every side covers it with room to spare.
 */
const SCENERY_OVERSCAN = 1.06;

/** How far in from each edge fighters stand, as a fraction of stage width. */
const SPAWN_INSET = 0.24;

/**
 * The battle canvas.
 *
 * Owns the Pixi application and the scene graph. Layers are separated so that
 * later primitives have somewhere sensible to act:
 *
 *   backdrop   battleground fill — bled past the edges, rides the shake
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
  /** Darkened bands at top and bottom, so the overlay reads over any photo. */
  private readonly vignette = new Graphics();
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
    this.world.addChild(this.vignette);
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
    // Bled past every edge for the same reason the photograph is: it rides the
    // shake, and a fill cut to the stage slid off it and showed blank canvas.
    const bleed = Math.max(this.width, this.height) * (SCENERY_OVERSCAN - 1);
    this.backdrop.drawRect(-bleed, -bleed, this.width + bleed * 2, this.height + bleed * 2);
    this.backdrop.endFill();

    void this.loadScene(ground.image);

    // A vignette: the photographs are bright at the edges and the overlay is
    // not, so the corners are pulled down to give the health bars, the name
    // cards and the damage numbers something to sit against.
    this.vignette.clear();
    this.vignette.beginFill(0x000000, 0.34);
    this.vignette.drawRect(0, 0, this.width, this.height * 0.26);
    this.vignette.endFill();
    this.vignette.beginFill(0x000000, 0.22);
    this.vignette.drawRect(0, this.height * 0.82, this.width, this.height * 0.18);
    this.vignette.endFill();

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
    const texture = await loadTexture(url);
    // The flat colour underneath is a perfectly good battleground, and the
    // failure has already been reported by whoever tried to load it.
    if (!texture || this.destroyed) return;

    this.scene.texture = texture;
    this.fitScene();
  }

  /**
   * Covers the stage with the photograph, whatever shape either of them is.
   *
   * Deliberately larger than the stage — see SCENERY_OVERSCAN — and centred,
   * so the overspill is shared evenly and the shake never reaches an edge.
   */
  private fitScene(): void {
    const { texture } = this.scene;
    if (texture === Texture.EMPTY || texture.width === 0) return;
    const scale = Math.max(this.width / texture.width, this.height / texture.height)
      * SCENERY_OVERSCAN;
    this.scene.scale.set(scale);
    this.scene.x = (this.width - texture.width * scale) / 2;
    this.scene.y = (this.height - texture.height * scale) / 2;
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
    // The portrait hangs off the outer end, so both bars are inset by it —
    // otherwise the left-hand face sits off the edge of the screen.
    bar.x = side === 'left'
      ? margin + HealthBar.overhang
      : this.width - margin - HealthBar.width - HealthBar.overhang;
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
   * Raises a guard on the sides a fighter chose to cover.
   *
   * Shown before the blow rather than as it lands, because the guess was made
   * before either player saw anything and the screen should say so: the shield
   * is up, and then it is either in the way or it is not.
   *
   * Returns the way to take it down again — whoever put it up is the only one
   * who knows when the exchange it belongs to is finished.
   */
  showGuard(fighter: Fighter, sides: readonly GuardSide[]): () => void {
    const shields: Sprite[] = [];
    const reach = Math.max(fighter.height * 0.42, 54);
    const middle = fighter.root.y - fighter.height * 0.5;

    for (const side of sides) {
      const shield = spawnEffect(this.effects, 'shield', {
        x: fighter.root.x + (side === 'left' ? -reach : side === 'right' ? reach : 0),
        y: side === 'top' ? middle - reach
          : side === 'bottom' ? middle + reach
            : middle,
        height: fighter.height * 0.42,
      });
      if (!shield) continue;
      shield.alpha = 0;
      shields.push(shield);
      gsap.fromTo(shield,
        { alpha: 0 },
        { alpha: 0.85, duration: 0.22, ease: 'power2.out' });
      // A slow breath, so a guard that is up for a whole exchange does not
      // read as a sticker somebody left on the screen.
      gsap.to(shield.scale, {
        x: shield.scale.x * 1.06, y: shield.scale.y * 1.06,
        duration: 0.9, repeat: -1, yoyo: true, ease: 'sine.inOut',
      });
    }

    return () => {
      for (const shield of shields) {
        gsap.killTweensOf([shield, shield.scale]);
        if (!shield.destroyed) shield.destroy();
      }
      shields.length = 0;
    };
  }

  /**
   * HIT or MISS, over the fighter it happened to.
   *
   * The one thing on screen that says whether the guessing came off. Without
   * it a blocked blow is just a blow that did less damage, and the round's
   * whole decision is invisible.
   */
  async callResult(fighter: Fighter, hit: boolean): Promise<void> {
    const text = new Text(hit ? 'HIT!' : 'MISS!', {
      fontFamily: 'Verdana, Geneva, sans-serif',
      fontSize: 72,
      fontWeight: 'bold',
      fill: hit ? palette.coral : palette.mint,
      stroke: palette.cream,
      strokeThickness: 9,
    });
    text.anchor.set(0.5, 0.5);
    text.x = fighter.root.x;
    text.y = fighter.root.y - fighter.height * 0.62;
    this.effects.addChild(text);

    const tl = gsap.timeline();
    tl.fromTo(text.scale,
      { x: 0.3, y: 0.3 },
      { x: 1.1, y: 1.1, duration: 0.2, ease: 'back.out(3)' });
    tl.to(text.scale, { x: 1, y: 1, duration: 0.1 });
    // A miss slides off the way the blow went; a hit stays where it landed.
    if (!hit) tl.to(text, { x: text.x + 70, duration: 0.7, ease: 'power2.out' }, 0.2);
    tl.to(text, { alpha: 0, duration: 0.3, ease: 'power2.in' }, 0.75);

    await new Promise<void>((resolve) => {
      tl.eventCallback('onComplete', () => {
        gsap.killTweensOf([text, text.scale]);
        if (!text.destroyed) text.destroy();
        resolve();
      });
    });
  }

  /**
   * Announces a fighter by name, in the game's own lettering.
   *
   * The brief asks for a reveal rather than two sprites simply being present:
   * a name big on the screen, one fighter at a time. It sits on the overlay so
   * the entrance can shake the world underneath it without the name wobbling.
   */
  /**
   * Rattles the world layer.
   *
   * The overlay does not move with it, so names, health and damage stay
   * readable while the ground under the fight does not.
   */
  shake(intensity = 5, seconds = 0.4): void {
    const strength = Math.max(1, Math.min(10, intensity)) * 3;
    gsap.killTweensOf(this.world.position);
    const tl = gsap.timeline({
      onComplete: () => { this.world.position.set(0, 0); },
    });
    const steps = Math.max(3, Math.round(seconds / 0.05));
    for (let i = 0; i < steps; i++) {
      const falloff = 1 - i / steps;
      tl.to(this.world.position, {
        x: (Math.random() - 0.5) * strength * falloff,
        y: (Math.random() - 0.5) * strength * falloff,
        duration: seconds / steps,
        ease: 'none',
      });
    }
    tl.to(this.world.position, { x: 0, y: 0, duration: 0.08 });
  }

  /**
   * A full-width card across the middle of the screen.
   *
   * Used for the beats between fighters arriving and the fight starting —
   * "versus", "fight" — which the stage had no way of saying before, so the
   * room had to work out from the animation alone that anything had changed.
   */
  async proclaim(text: string, seconds = 1.1): Promise<void> {
    const card = new Graphics();
    const height = this.height * 0.2;
    card.beginFill(0x000000, 0.62);
    card.drawRect(-this.width, this.height / 2 - height / 2, this.width * 3, height);
    card.endFill();
    card.alpha = 0;
    this.overlay.addChild(card);

    // Long enough for a matchup — "ANN VERSUS BO" — not only a single word.
    // Whatever is given is shrunk to the width below, so a long pair of names
    // gets smaller letters rather than a truncated one.
    const letters = await BubbleText.create(text.toUpperCase().slice(0, 40), {
      height: height * 0.62,
      jitter: 3,
    });
    const room = this.width * 0.84;
    if (letters.width > room) letters.scale.set(room / letters.width);

    /*
     * Centred on the band by its own measured bounds.
     *
     * Subtracting half the height assumes the word's box starts at its own
     * origin, and a line of hand-cut letters does not: the tallest glyph sets
     * the box, the shorter ones hang inside it, and the whole thing sat high
     * of the band it was supposed to be lying on. Measuring says where the
     * ink actually is.
     */
    const ink = letters.getLocalBounds();
    letters.x = this.width / 2 - (ink.x + ink.width / 2) * letters.scale.x;
    letters.y = this.height / 2 - (ink.y + ink.height / 2) * letters.scale.y;
    letters.alpha = 0;
    this.overlay.addChild(letters);

    const tl = gsap.timeline();
    // The band arrives first and wide, the word lands into it: two movements
    // rather than one is what makes it read as an announcement.
    tl.fromTo(card, { alpha: 0 }, { alpha: 1, duration: 0.16, ease: 'power2.out' });
    tl.fromTo(card.scale, { y: 0.2 }, { y: 1, duration: 0.22, ease: 'power3.out' }, '<');
    tl.fromTo(letters, { alpha: 0, x: letters.x - this.width * 0.06 },
      { alpha: 1, x: letters.x, duration: 0.26, ease: 'back.out(1.8)' }, '-=0.06');
    tl.to([card, letters], { alpha: 0, duration: 0.24 }, `+=${Math.max(0.15, seconds - 0.7)}`);

    await new Promise<void>((resolve) => {
      tl.eventCallback('onComplete', () => {
        // Same rule as everywhere: stop animating it, then take it away.
        gsap.killTweensOf([card, card.scale, letters, letters.scale]);
        if (!card.destroyed) card.destroy();
        if (!letters.destroyed) letters.destroy({ children: true });
        resolve();
      });
    });
  }

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
    // Three hops rather than two, over a longer walk: an entrance that is over
    // before the room has looked up is not an entrance. A slide would read as
    // the sprite being dragged; hops read as a character arriving under its
    // own power.
    tl.to(fighter.root, { x: home, duration: 1.5, ease: 'power2.out' });
    for (const at of [0, 0.42, 0.84]) {
      tl.to(fighter.root, { y: ground - 105, duration: 0.28, ease: 'power2.out' }, at);
      tl.to(fighter.root, { y: ground, duration: 0.3, ease: 'power2.in' }, at + 0.28);
      tl.to(fighter.body, { scaleY: 0.86, scaleX: 1.12, duration: 0.1 }, at + 0.58);
      tl.to(fighter.body, { scaleY: 1, scaleX: 1, duration: 0.16 }, at + 0.68);
    }

    // Landing: a squash deeper than the hops, and the stage takes it.
    tl.to(fighter.body, { scaleY: 0.8, scaleX: 1.2, duration: 0.1 }, 1.5);
    tl.to(fighter.body, { scaleY: 1, scaleX: 1, duration: 0.26, ease: 'elastic.out(1, 0.45)' });
    tl.call(() => this.shake(6, 0.3), undefined, 1.5);

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
   * Walks everybody back to their mark, and waits while they do.
   *
   * A move leaves its fighter wherever it finished — charged in, knocked back,
   * teleported behind somebody — and the next move snapped them home before it
   * started, so the return read as a glitch between two moves rather than the
   * end of one. Walking back is the same correction made visible, and it gives
   * the round a moment to breathe before the other one steps up.
   *
   * Positions only. The pose is settled by the move's own last step, and
   * anything left over is cleared by `reset` when the next move begins.
   */
  async returnToMarks(seconds = 0.55): Promise<void> {
    const walks = [...this.sides.entries()].map(([fighter, side]) => {
      const home = this.homeX(side);
      if (Math.abs(fighter.root.x - home) < 2) return null;
      return gsap.to(fighter.root, {
        x: home,
        duration: seconds,
        ease: 'power2.inOut',
      });
    }).filter((tween): tween is gsap.core.Tween => tween !== null);

    if (walks.length === 0) return;
    await Promise.all(walks.map((tween) => new Promise<void>((resolve) => {
      tween.eventCallback('onComplete', resolve);
      // A stage torn down mid-walk must not leave the round waiting.
      tween.eventCallback('onInterrupt', resolve);
    })));
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

    /*
     * Nothing may still be animating what is about to be freed.
     *
     * Killing the fighters' tweens is the fighters' own job, but the stage
     * animates plenty in its own right — the shake, the vignette, the
     * scenery, and whatever proclamation was halfway through when the screen
     * went. A tween that survives its target writes into a freed Pixi object
     * from inside GSAP's render loop, where no caller can catch it, and the
     * player is shown "something went wrong" about a game that had finished
     * perfectly well.
     */
    for (const layer of [this.world, this.overlay, this.effects, this.fighters,
      this.vignette, this.ground, this.scene, this.backdrop]) {
      gsap.killTweensOf([layer, layer.position, layer.scale]);
    }
    for (const child of [...this.overlay.children]) {
      gsap.killTweensOf([child, child.position, child.scale]);
    }

    this.app.destroy(true, { children: true });
  }
}
