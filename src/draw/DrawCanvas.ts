import {
  CANVAS_H, CANVAS_W, type CropHandle, type FillStroke, type FreehandStroke,
  type ImageStroke, type Point, type Selection, type ShapeStroke, type Stroke,
  type ToolName,
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

  /** The marquee, if the select tool has one. Drawn as an overlay, not a stroke. */
  selection: Selection | null = null;
  /** What was last copied or cut, as a PNG data URL, with its size. */
  private clipboard: { data: string; w: number; h: number } | null = null;
  /** A pasted image being positioned, not yet committed to history. */
  private floating: ImageStroke | null = null;
  private floatingImage: HTMLImageElement | null = null;
  /** Offset from the pointer to the floating paste's corner while dragging. */
  private dragOrigin: { x: number; y: number } | null = null;
  /** Decoded pastes, keyed by data URL, so a repaint does not re-decode. */
  private readonly imageCache = new Map<string, HTMLImageElement>();

  /** The crop frame over the floating layer, while cropping. */
  private cropRect: Selection | null = null;
  private activeHandle: CropHandle | null = null;
  private cropGrabOffset = { x: 0, y: 0 };
  /** Overlay for the marquee and floating paste, kept off the drawing itself. */
  private readonly overlay: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.canvas.className = 'draw-canvas';
    parent.appendChild(this.canvas);

    // The marquee and any floating paste live on a second canvas, so they can
    // be redrawn every frame without touching the artwork underneath.
    this.overlay = document.createElement('canvas');
    this.overlay.width = CANVAS_W;
    this.overlay.height = CANVAS_H;
    this.overlay.className = 'draw-overlay';
    parent.appendChild(this.overlay);

    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    const overlayCtx = this.overlay.getContext('2d');
    if (!ctx || !overlayCtx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.overlayCtx = overlayCtx;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.clearSurface();
  }

  /** Converts a pointer event to canvas coordinates. */
  toCanvas(event: PointerEvent): Point {
    const rect = this.overlay.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
      // Mice report 0 or 0.5 inconsistently; treat anything falsy as medium.
      p: event.pressure > 0 ? event.pressure : 0.5,
    };
  }

  // ------------------------------------------------------------------ drawing

  beginStroke(tool: ToolName, colour: string, size: number, at: Point, filled: boolean): void {
    // Starting anything else commits a paste that is still being positioned.
    if (tool !== 'select') this.commitFloating();

    if (tool === 'select') {
      if (this.floating && this.hitsFloating(at)) {
        this.dragOrigin = { x: at.x - this.floating.x, y: at.y - this.floating.y };
        return;
      }
      this.selection = { x: at.x, y: at.y, w: 0, h: 0 };
      this.drawOverlay();
      return;
    }

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
    if (this.dragOrigin && this.floating) {
      this.floating.x = at.x - this.dragOrigin.x;
      this.floating.y = at.y - this.dragOrigin.y;
      this.drawOverlay();
      return;
    }
    if (this.selection && !this.live) {
      this.selection.w = at.x - this.selection.x;
      this.selection.h = at.y - this.selection.y;
      this.drawOverlay();
      return;
    }
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
    if (this.dragOrigin) { this.dragOrigin = null; return; }
    if (this.selection && !this.live) {
      // A click with no drag clears the marquee rather than leaving a sliver.
      if (Math.abs(this.selection.w) < 4 || Math.abs(this.selection.h) < 4) {
        this.selection = null;
        this.drawOverlay();
      }
      this.onChange?.();
      return;
    }
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

  /** Export must not include the marquee, so flatten any floating paste first. */
  private flattenForExport(): void {
    this.commitFloating();
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
      case 'image':
        this.paintImage(stroke);
        break;
    }
  }

  /**
   * Image strokes are drawn from a cached HTMLImageElement.
   *
   * Decoding a data URL is asynchronous, so on a repaint the image may not be
   * ready yet; the cache is keyed by data URL and triggers one more repaint
   * once it loads, rather than leaving a gap.
   */
  private paintImage(stroke: ImageStroke): void {
    const cached = this.imageCache.get(stroke.data);
    if (cached?.complete) {
      this.ctx.drawImage(cached, stroke.x, stroke.y, stroke.w, stroke.h);
      return;
    }
    if (cached) return;
    const img = new Image();
    this.imageCache.set(stroke.data, img);
    img.addEventListener('load', () => this.repaint());
    img.src = stroke.data;
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
    // A deleted selection is a filled rect that cuts transparency instead of
    // painting, so it stays undoable like any other stroke.
    if (stroke.erase) ctx.globalCompositeOperation = 'destination-out';
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

  // ---------------------------------------------------------------- selection

  /** The marquee normalised so width and height are positive. */
  private normalisedSelection(): Selection | null {
    const s = this.selection;
    if (!s) return null;
    const x = Math.max(0, Math.min(s.x, s.x + s.w));
    const y = Math.max(0, Math.min(s.y, s.y + s.h));
    const w = Math.min(CANVAS_W - x, Math.abs(s.w));
    const h = Math.min(CANVAS_H - y, Math.abs(s.h));
    return w > 1 && h > 1 ? { x, y, w, h } : null;
  }

  get hasSelection(): boolean { return this.normalisedSelection() !== null; }
  get hasClipboard(): boolean { return this.clipboard !== null; }
  get hasFloating(): boolean { return this.floating !== null; }

  /** The element that receives pointer events — the overlay sits on top. */
  get surface(): HTMLCanvasElement { return this.overlay; }

  /** Throws away the stroke in progress without committing it to history. */
  abortStroke(): void {
    if (!this.live) return;
    this.live = null;
    this.repaint();
  }

  /**
   * Selects the connected shape under a point — the "subject" a player means
   * when they hold a finger on something.
   *
   * Floods outward across pixels that are drawn on at all, then takes the
   * bounding box of what it reached. Colour is deliberately ignored: a drawing
   * is usually many colours but one object, and matching on colour would grab
   * only part of it.
   *
   * Returns false when the point is on empty canvas.
   */
  selectSubjectAt(at: Point): boolean {
    const x0 = Math.floor(at.x);
    const y0 = Math.floor(at.y);
    if (x0 < 0 || y0 < 0 || x0 >= CANVAS_W || y0 >= CANVAS_H) return false;

    const { data } = this.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    const solid = (x: number, y: number) => data[(y * CANVAS_W + x) * 4 + 3]! > 16;
    if (!solid(x0, y0)) return false;

    const seen = new Uint8Array(CANVAS_W * CANVAS_H);
    const stack = [x0, y0];
    let minX = x0, maxX = x0, minY = y0, maxY = y0;

    // Scanline flood: per-pixel queues are far too slow at this size on a phone.
    while (stack.length) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      while (x >= 0 && solid(x, y) && !seen[y * CANVAS_W + x]) x--;
      x++;

      let spanAbove = false;
      let spanBelow = false;
      while (x < CANVAS_W && solid(x, y) && !seen[y * CANVAS_W + x]) {
        seen[y * CANVAS_W + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        if (y > 0) {
          const above = solid(x, y - 1) && !seen[(y - 1) * CANVAS_W + x];
          if (above && !spanAbove) { stack.push(x, y - 1); spanAbove = true; }
          else if (!above) spanAbove = false;
        }
        if (y < CANVAS_H - 1) {
          const below = solid(x, y + 1) && !seen[(y + 1) * CANVAS_W + x];
          if (below && !spanBelow) { stack.push(x, y + 1); spanBelow = true; }
          else if (!below) spanBelow = false;
        }
        x++;
      }
    }

    // A little padding so anti-aliased edges are not clipped off.
    const pad = 3;
    this.selection = {
      x: Math.max(0, minX - pad),
      y: Math.max(0, minY - pad),
      w: Math.min(CANVAS_W, maxX + pad) - Math.max(0, minX - pad) + 1,
      h: Math.min(CANVAS_H, maxY + pad) - Math.max(0, minY - pad) + 1,
    };
    this.drawOverlay();
    this.onChange?.();
    return true;
  }

  /**
   * Drops an image in as a floating layer, so it can be positioned before it
   * lands — the same path a paste takes, for the same reason.
   */
  placeImage(data: string, x: number, y: number, w: number, h: number): void {
    this.commitFloating();
    this.floating = { kind: 'image', tool: 'select', data, x, y, w, h };
    this.floatingImage = new Image();
    this.floatingImage.addEventListener('load', () => this.drawOverlay());
    this.floatingImage.src = data;
    this.selection = null;
    this.drawOverlay();
    this.onChange?.();
  }

  /** The floating layer, for tools that need to resize or replace it. */
  get floatingLayer(): { data: string; x: number; y: number; w: number; h: number } | null {
    return this.floating ? { ...this.floating } : null;
  }

  /** Rescales the floating layer about its centre. */
  scaleFloating(factor: number): void {
    const f = this.floating;
    if (!f) return;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    f.w = Math.max(24, f.w * factor);
    f.h = Math.max(24, f.h * factor);
    f.x = cx - f.w / 2;
    f.y = cy - f.h / 2;
    this.drawOverlay();
  }

  /** Swaps the floating layer's picture, keeping its position and size. */
  replaceFloating(data: string): void {
    if (!this.floating) return;
    this.floating.data = data;
    this.floatingImage = new Image();
    this.floatingImage.addEventListener('load', () => this.drawOverlay());
    this.floatingImage.src = data;
    this.onChange?.();
  }

  /**
   * Crops the floating layer to the marquee.
   *
   * Both rectangles are in canvas coordinates; the overlap between them is
   * converted to fractions of the layer so the source image's own resolution
   * stays out of it.
   */
  async cropFloatingToSelection(
    crop: (data: string, fx: number, fy: number, fw: number, fh: number) => Promise<string>,
  ): Promise<boolean> {
    const f = this.floating;
    const area = this.normalisedSelection();
    if (!f || !area) return false;

    const x = Math.max(area.x, f.x);
    const y = Math.max(area.y, f.y);
    const x2 = Math.min(area.x + area.w, f.x + f.w);
    const y2 = Math.min(area.y + area.h, f.y + f.h);
    if (x2 - x < 4 || y2 - y < 4) return false;

    const data = await crop(f.data, (x - f.x) / f.w, (y - f.y) / f.h, (x2 - x) / f.w, (y2 - y) / f.h);

    this.floating = { ...f, data, x, y, w: x2 - x, h: y2 - y };
    this.floatingImage = new Image();
    this.floatingImage.addEventListener('load', () => this.drawOverlay());
    this.floatingImage.src = data;
    this.selection = null;
    this.drawOverlay();
    this.onChange?.();
    return true;
  }

  // -------------------------------------------------------------------- crop

  /**
   * Crop handles, sized in canvas units.
   *
   * The canvas is drawn far smaller than its 1024 logical pixels, so a handle
   * that looks right in canvas space would be a few pixels on screen. These
   * are deliberately large: the hit area is bigger again than the drawn one,
   * which is what makes corners catchable with a finger.
   */
  static readonly HANDLE_DRAW = 26;
  static readonly HANDLE_HIT = 52;

  get isCropping(): boolean { return this.cropRect !== null; }

  /** Starts cropping the floating layer, framed to its current bounds. */
  beginCrop(): boolean {
    const f = this.floating;
    if (!f) return false;
    this.cropRect = { x: f.x, y: f.y, w: f.w, h: f.h };
    this.selection = null;
    this.drawOverlay();
    this.onChange?.();
    return true;
  }

  cancelCrop(): void {
    if (!this.cropRect) return;
    this.cropRect = null;
    this.activeHandle = null;
    this.drawOverlay();
    this.onChange?.();
  }

  /** Which handle, if any, is under a point. */
  cropHandleAt(at: Point): CropHandle | null {
    const r = this.cropRect;
    if (!r) return null;
    const hit = DrawCanvas.HANDLE_HIT / 2;
    const midX = r.x + r.w / 2;
    const midY = r.y + r.h / 2;

    const spots: [CropHandle, number, number][] = [
      ['nw', r.x, r.y], ['n', midX, r.y], ['ne', r.x + r.w, r.y],
      ['e', r.x + r.w, midY], ['se', r.x + r.w, r.y + r.h],
      ['s', midX, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, midY],
    ];
    for (const [name, hx, hy] of spots) {
      if (Math.abs(at.x - hx) <= hit && Math.abs(at.y - hy) <= hit) return name;
    }
    // Inside the frame drags the whole thing.
    if (at.x > r.x && at.x < r.x + r.w && at.y > r.y && at.y < r.y + r.h) return 'move';
    return null;
  }

  beginCropDrag(handle: CropHandle, at: Point): void {
    this.activeHandle = handle;
    if (this.cropRect) {
      this.cropGrabOffset = { x: at.x - this.cropRect.x, y: at.y - this.cropRect.y };
    }
  }

  /**
   * Moves whichever edge or corner is held.
   *
   * The frame is clamped to the layer's bounds — cropping can only ever take
   * away, so a handle dragged outside the photo would reveal nothing — and to
   * a minimum size, so it cannot be collapsed to a line and lost.
   */
  dragCrop(at: Point): void {
    const r = this.cropRect;
    const f = this.floating;
    if (!r || !f || !this.activeHandle) return;

    const MIN = 40;
    const left = f.x, top = f.y, right = f.x + f.w, bottom = f.y + f.h;
    let { x, y, w, h } = r;

    const setLeft = (nx: number) => {
      const clamped = Math.min(Math.max(left, nx), x + w - MIN);
      w += x - clamped;
      x = clamped;
    };
    const setTop = (ny: number) => {
      const clamped = Math.min(Math.max(top, ny), y + h - MIN);
      h += y - clamped;
      y = clamped;
    };
    const setRight = (nx: number) => { w = Math.min(Math.max(MIN, nx - x), right - x); };
    const setBottom = (ny: number) => { h = Math.min(Math.max(MIN, ny - y), bottom - y); };

    switch (this.activeHandle) {
      case 'nw': setLeft(at.x); setTop(at.y); break;
      case 'n': setTop(at.y); break;
      case 'ne': setRight(at.x); setTop(at.y); break;
      case 'e': setRight(at.x); break;
      case 'se': setRight(at.x); setBottom(at.y); break;
      case 's': setBottom(at.y); break;
      case 'sw': setLeft(at.x); setBottom(at.y); break;
      case 'w': setLeft(at.x); break;
      case 'move': {
        x = Math.min(Math.max(left, at.x - this.cropGrabOffset.x), right - w);
        y = Math.min(Math.max(top, at.y - this.cropGrabOffset.y), bottom - h);
        break;
      }
    }

    this.cropRect = { x, y, w, h };
    this.drawOverlay();
  }

  endCropDrag(): void { this.activeHandle = null; }

  /** Applies the crop frame to the floating layer. */
  async applyCrop(
    crop: (data: string, fx: number, fy: number, fw: number, fh: number) => Promise<string>,
  ): Promise<boolean> {
    const r = this.cropRect;
    const f = this.floating;
    if (!r || !f) return false;

    const data = await crop(
      f.data, (r.x - f.x) / f.w, (r.y - f.y) / f.h, r.w / f.w, r.h / f.h,
    );

    this.floating = { ...f, data, x: r.x, y: r.y, w: r.w, h: r.h };
    this.floatingImage = new Image();
    this.floatingImage.addEventListener('load', () => this.drawOverlay());
    this.floatingImage.src = data;
    this.cropRect = null;
    this.activeHandle = null;
    this.drawOverlay();
    this.onChange?.();
    return true;
  }

  selectAll(): void {
    this.selection = { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    this.drawOverlay();
    this.onChange?.();
  }

  clearSelection(): void {
    this.selection = null;
    this.drawOverlay();
    this.onChange?.();
  }

  /** Copies the marquee's contents. */
  copy(): void {
    const area = this.normalisedSelection();
    if (!area) return;
    const scratch = document.createElement('canvas');
    scratch.width = Math.round(area.w);
    scratch.height = Math.round(area.h);
    const sctx = scratch.getContext('2d');
    if (!sctx) return;
    sctx.drawImage(
      this.canvas, area.x, area.y, area.w, area.h, 0, 0, scratch.width, scratch.height,
    );
    this.clipboard = { data: scratch.toDataURL('image/png'), w: area.w, h: area.h };
    this.onChange?.();
  }

  /** Copies, then erases what was copied. */
  cut(): void {
    const area = this.normalisedSelection();
    if (!area) return;
    this.copy();
    this.deleteSelection();
  }

  /** Erases the marquee's contents as an undoable stroke. */
  deleteSelection(): void {
    const area = this.normalisedSelection();
    if (!area) return;
    this.strokes.push({
      kind: 'shape', tool: 'rect', colour: '#000', size: 0, filled: true,
      from: { x: area.x, y: area.y, p: 1 },
      to: { x: area.x + area.w, y: area.y + area.h, p: 1 },
      erase: true,
    } as ShapeStroke);
    this.redoStack = [];
    this.repaint();
    this.selection = null;
    this.drawOverlay();
    this.onChange?.();
  }

  /**
   * Pastes as a FLOATING image the player can drag before it lands.
   *
   * Committing straight away would make positioning impossible on a phone,
   * where there is no cursor to paste under.
   */
  paste(): void {
    if (!this.clipboard) return;
    const area = this.normalisedSelection();
    const x = area ? area.x + 24 : (CANVAS_W - this.clipboard.w) / 2;
    const y = area ? area.y + 24 : (CANVAS_H - this.clipboard.h) / 2;
    this.floating = {
      kind: 'image', tool: 'select', data: this.clipboard.data,
      x, y, w: this.clipboard.w, h: this.clipboard.h,
    };
    this.floatingImage = new Image();
    this.floatingImage.addEventListener('load', () => this.drawOverlay());
    this.floatingImage.src = this.clipboard.data;
    this.selection = null;
    this.drawOverlay();
    this.onChange?.();
  }

  /** Drops a floating paste onto the drawing, as an undoable stroke. */
  commitFloating(): void {
    if (!this.floating) return;
    this.strokes.push(this.floating);
    this.redoStack = [];
    this.paintStroke(this.floating);
    this.floating = null;
    this.floatingImage = null;
    this.drawOverlay();
    this.onChange?.();
  }

  /** Throws away a floating paste without committing it. */
  cancelFloating(): void {
    if (!this.floating) return;
    this.floating = null;
    this.floatingImage = null;
    this.drawOverlay();
    this.onChange?.();
  }

  /** Whether a point lands on the floating layer. */
  isOverFloating(at: Point): boolean {
    return this.hitsFloating(at);
  }

  private hitsFloating(at: Point): boolean {
    const f = this.floating;
    if (!f) return false;
    return at.x >= f.x && at.x <= f.x + f.w && at.y >= f.y && at.y <= f.y + f.h;
  }

  /** Repaints the marquee and floating paste. Never touches the artwork. */
  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    if (this.floating && this.floatingImage?.complete) {
      const f = this.floating;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(this.floatingImage, f.x, f.y, f.w, f.h);
      ctx.globalAlpha = 1;

      if (this.cropRect) {
        this.strokeCropFrame(ctx, this.cropRect, f);
      } else {
        this.strokeMarquee(ctx, f.x, f.y, f.w, f.h);
      }
      return;
    }

    const area = this.normalisedSelection();
    if (area) this.strokeMarquee(ctx, area.x, area.y, area.w, area.h);
  }

  /**
   * The crop frame: what stays, framed in dashes, with everything being cut
   * away dimmed so it is obvious what the crop will take.
   */
  private strokeCropFrame(
    ctx: CanvasRenderingContext2D, r: Selection, f: { x: number; y: number; w: number; h: number },
  ): void {
    ctx.save();

    // Dim the parts of the photo outside the frame.
    ctx.fillStyle = 'rgba(30, 26, 36, 0.5)';
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill('evenodd');

    // Thirds, the way a crop tool usually guides framing.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(r.x + (r.w * i) / 3, r.y);
      ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h);
      ctx.moveTo(r.x, r.y + (r.h * i) / 3);
      ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3);
    }
    ctx.stroke();

    this.strokeMarquee(ctx, r.x, r.y, r.w, r.h);

    // Handles, drawn last so nothing overlaps them.
    const d = DrawCanvas.HANDLE_DRAW;
    const midX = r.x + r.w / 2;
    const midY = r.y + r.h / 2;
    const spots: [number, number][] = [
      [r.x, r.y], [midX, r.y], [r.x + r.w, r.y],
      [r.x + r.w, midY], [r.x + r.w, r.y + r.h],
      [midX, r.y + r.h], [r.x, r.y + r.h], [r.x, midY],
    ];
    for (const [hx, hy] of spots) {
      ctx.fillStyle = '#4a4458';
      ctx.fillRect(hx - d / 2 - 3, hy - d / 2 - 3, d + 6, d + 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hx - d / 2, hy - d / 2, d, d);
    }

    ctx.restore();
  }

  /** A marching-ants rectangle, readable over any artwork. */
  private strokeMarquee(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  ): void {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = '#4a4458';
    ctx.setLineDash([12, 10]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  // ------------------------------------------------------------------- export

  /** The drawing as a transparent PNG data URL. */
  toDataURL(): string {
    this.flattenForExport();
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
