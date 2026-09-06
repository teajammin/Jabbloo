/**
 * Drawing model.
 *
 * Strokes are stored as data, not baked into pixels, so undo is exact, the
 * canvas can be re-rendered at any resolution, and a finished drawing can be
 * sent over the network as JSON rather than a bitmap.
 */

export type ToolName = 'pen' | 'eraser' | 'fill' | 'rect' | 'ellipse' | 'line' | 'select';

/** The six thicknesses the brief calls for, in CSS pixels at 1x. */
export const THICKNESSES = [2, 5, 10, 18, 30, 48] as const;
export type Thickness = (typeof THICKNESSES)[number];

export interface Point {
  x: number;
  y: number;
  /** 0-1. Stylus pressure where available, else 0.5. */
  p: number;
}

export interface FreehandStroke {
  kind: 'freehand';
  tool: 'pen' | 'eraser';
  colour: string;
  size: number;
  points: Point[];
}

export interface ShapeStroke {
  kind: 'shape';
  tool: 'rect' | 'ellipse' | 'line';
  colour: string;
  size: number;
  filled: boolean;
  from: Point;
  to: Point;
  /** Set when the rectangle is a deleted selection: it cuts rather than paints. */
  erase?: boolean;
}

export interface FillStroke {
  kind: 'fill';
  tool: 'fill';
  colour: string;
  at: Point;
}

/**
 * A pasted or stamped image.
 *
 * Pasting has to be a stroke like any other, or it would sit outside the
 * history and undo would step straight past it.
 */
export interface ImageStroke {
  kind: 'image';
  tool: 'select';
  /** PNG data URL. */
  data: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangular marquee, in canvas coordinates. */
export interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Stroke = FreehandStroke | ShapeStroke | FillStroke | ImageStroke;

/**
 * The canvas' logical size. Drawings are stored at this resolution.
 *
 * Square, so the drawing area reads the same on a phone and a laptop. The
 * display size is always derived from this ratio, so drawn coordinates are
 * never stretched on either.
 */
export const CANVAS_W = 1024;
export const CANVAS_H = 1024;
