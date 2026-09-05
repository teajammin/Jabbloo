import {
  CANVAS_H, CANVAS_W, type FillStroke, type FreehandStroke, type Point,
  type ShapeStroke, type Stroke, type ToolName,
} from './types';

/**
 * The drawing surface.
 *
 * Keeps a list of strokes and replays them, rather than painting straight onto
 * the canvas. That makes undo exact, lets the drawing be re-rendered at any
 * size, and means a finished character can travel to the host as JSON instead
 * of a bitmap.
 *
 * Replaying every stroke on every frame would get slow on a phone after a few
 * hundred strokes, so committed work is cached: the canvas only redraws from
 * scratch on undo, and otherwise just draws the newest stroke on top.
 */
export class DrawCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  /** The stroke being drawn right now, not yet committed. */
  private live: Stroke | null = null;

  private onChange: (() => void) | undefined;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.canvas.className = 'draw-canvas';
    parent.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.clearSurface();
  }

  /** Converts a pointer event to canvas coordinates. */
  toCanvas(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
      // Mice report 0 or 0.5 inconsistently; treat anything falsy as medium.
      p: event.pressure > 0 ? event.pressure : 0.5,
    };
  }

  // ------------------------------------------------------------------ drawing

  beginStroke(tool: ToolName, colour: string, size: number, at: Point, filled: boolean): void {
    this.redoStack = [];

    if (tool === 'fill') {
      this.live = { kind: 'fill', tool, colour, at } satisfies FillStroke;
      this.commit();
      return;
    }

    if (tool === 'pen' || tool === 'eraser') {
      this.live = { kind: 'freehand', tool, colour, size, points: [at] } satisfies FreehandStroke;
    } else {
      this.live = { kind: 'shape', tool, colour, size, filled, from: at, to: at } satisfies ShapeStroke;
    }
  }

  extendStroke(at: Point): void {
    if (!this.live) return;
    if (this.live.kind === 'freehand') {
      const last = this.live.points[this.live.points.length - 1]!;
      // Drop near-duplicate samples; phones fire pointermove far faster than
      // the drawing needs, and every extra point costs on replay.
      if (Math.hypot(at.x - last.x, at.y - last.y) < 1.2) return;
      this.live.points.push(at);
      this.paintFreehandSegment(this.live, this.live.points.length - 2);
      return;
    }
    if (this.live.kind === 'shape') {
      this.live.to = at;
      // A shape is rubber-banded, so the whole surface has to be repainted.
      this.repaint();
      this.paintStroke(this.live);
    }
  }

  endStroke(): void {
    if (!this.live) return;
    if (this.live.kind === 'freehand' && this.live.points.length === 1) {
      // A tap should still leave a dot.
      this.live.points.push({ ...this.live.points[0]! });
      this.paintStroke(this.live);
    }
    this.commit();
  }

  private commit(): void {
    if (!this.live) return;
    if (this.live.kind === 'fill') this.paintStroke(this.live);
    this.strokes.push(this.live);
    this.live = null;
    this.onChange?.();
  }

  // ------------------------------------------------------------------ history

  undo(): void {
    const popped = this.strokes.pop();
    if (!popped) return;
    this.redoStack.push(popped);
    this.repaint();
    this.onChange?.();
  }

  redo(): void {
    const restored = this.redoStack.pop();
    if (!restored) return;
    this.strokes.push(restored);
    this.paintStroke(restored);
    this.onChange?.();
  }

  clear(): void {
    if (this.strokes.length === 0) return;
    this.redoStack = [...this.strokes].reverse();
    this.strokes = [];
    this.repaint();
    this.onChange?.();
  }

  get canUndo(): boolean { return this.strokes.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get isEmpty(): boolean { return this.strokes.length === 0; }

  onChanged(fn: () => void): void { this.onChange = fn; }

  // ------------------------------------------------------------------ painting

  private clearSurface(): void {
    this.ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  }

  private repaint(): void {
    this.clearSurface();
    for (const stroke of this.strokes) this.paintStroke(stroke);
  }

  private paintStroke(stroke: Stroke): void {
    switch (stroke.kind) {
      case 'freehand':
        for (let i = 0; i < stroke.points.length - 1; i++) {
          this.paintFreehandSegment(stroke, i);
        }
        break;
      case 'shape':
        this.paintShape(stroke);
        break;
      case 'fill':
        this.paintFill(stroke);
        break;
    }
  }

  private paintFreehandSegment(stroke: FreehandStroke, index: number): void {
    const a = stroke.points[index];
    const b = stroke.points[index + 1];
    if (!a || !b) return;

    const ctx = this.ctx;
    ctx.save();
    // The eraser cuts transparency rather than painting white, so a character
    // exported as a PNG keeps a genuinely transparent background.
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.colour;
    ctx.lineWidth = stroke.size * (0.6 + b.p * 0.8);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  private paintShape(stroke: ShapeStroke): void {
    const ctx = this.ctx;
    const { from, to } = stroke;
    ctx.save();
    ctx.strokeStyle = stroke.colour;
    ctx.fillStyle = stroke.colour;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();

    if (stroke.tool === 'line') {
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else if (stroke.tool === 'rect') {
      ctx.rect(from.x, from.y, to.x - from.x, to.y - from.y);
      stroke.filled ? ctx.fill() : ctx.stroke();
    } else {
      ctx.ellipse(
        (from.x + to.x) / 2, (from.y + to.y) / 2,
        Math.abs(to.x - from.x) / 2, Math.abs(to.y - from.y) / 2,
        0, 0, Math.PI * 2,
      );
      stroke.filled ? ctx.fill() : ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Flood fill, scanline based.
   *
   * A pixel-by-pixel queue is far too slow at 1024x1024 on a phone; filling by
   * horizontal runs cuts the work by roughly the width of each run.
   */
  private paintFill(stroke: FillStroke): void {
    const x0 = Math.floor(stroke.at.x);
    const y0 = Math.floor(stroke.at.y);
    if (x0 < 0 || y0 < 0 || x0 >= CANVAS_W || y0 >= CANVAS_H) return;

    const image = this.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const data = image.data;
    const target = this.pixelAt(data, x0, y0);
    const replacement = parseColour(stroke.colour);
    if (colourMatches(target, replacement, 0)) return;

    const stack: number[] = [x0, y0];
    while (stack.length) {
      const y = stack.pop()!;
      let x = stack.pop()!;

      // Walk left to the start of this run.
      while (x >= 0 && colourMatches(this.pixelAt(data, x, y), target, 32)) x--;
      x++;

      let spanAbove = false;
      let spanBelow = false;
      while (x < CANVAS_W && colourMatches(this.pixelAt(data, x, y), target, 32)) {
        this.setPixel(data, x, y, replacement);

        if (y > 0) {
          const above = colourMatches(this.pixelAt(data, x, y - 1), target, 32);
          if (above && !spanAbove) { stack.push(x, y - 1); spanAbove = true; }
          else if (!above) spanAbove = false;
        }
        if (y < CANVAS_H - 1) {
          const below = colourMatches(this.pixelAt(data, x, y + 1), target, 32);
          if (below && !spanBelow) { stack.push(x, y + 1); spanBelow = true; }
          else if (!below) spanBelow = false;
        }
        x++;
      }
    }

    this.ctx.putImageData(image, 0, 0);
  }

  private pixelAt(data: Uint8ClampedArray, x: number, y: number): [number, number, number, number] {
    const i = (y * CANVAS_W + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
  }

  private setPixel(
    data: Uint8ClampedArray, x: number, y: number, c: [number, number, number, number],
  ): void {
    const i = (y * CANVAS_W + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3];
  }

  // ------------------------------------------------------------------- export

  /** The drawing as a transparent PNG data URL. */
  toDataURL(): string {
    return this.canvas.toDataURL('image/png');
  }

  /** The drawing as data, for sending to the host. */
  toJSON(): Stroke[] {
    return this.strokes;
  }

  load(strokes: Stroke[]): void {
    this.strokes = strokes;
    this.redoStack = [];
    this.repaint();
    this.onChange?.();
  }
}

// ------------------------------------------------------------------- colours

function parseColour(css: string): [number, number, number, number] {
  const hex = css.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    255,
  ];
}

/**
 * Tolerant colour comparison.
 *
 * Strokes are anti-aliased, so their edges are a gradient rather than a hard
 * boundary. An exact match leaves a visible halo of unfilled pixels around
 * every line.
 */
function colourMatches(
  a: [number, number, number, number],
  b: [number, number, number, number],
  tolerance: number,
): boolean {
  // Two fully transparent pixels match regardless of their RGB.
  if (a[3] === 0 && b[3] === 0) return true;
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs(a[3] - b[3]) <= tolerance
  );
}
