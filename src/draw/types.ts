/**
 * Drawing model.
 *
 * Strokes are stored as data, not baked into pixels, so undo is exact, the
 * canvas can be re-rendered at any resolution, and a finished drawing can be
 * sent over the network as JSON rather than a bitmap.
 */

export type ToolName = 'pen' | 'eraser' | 'fill' | 'rect' | 'ellipse' | 'line' | 'select';

/** The six thicknesses the brief calls for, in CSS pixels at 1x. */
/*
 * What a brush can be, in canvas pixels.
 *
 * Shifted heavier than it started. The canvas is 1024px and gets shown at a
 * third of that on a phone, so a 2px line was a hairline nobody could see
 * while drawing and the battleground then lost it completely against a busy
 * background. The thinnest is now a line rather than a hair, and the thickest
 * covers ground fast enough to fill a body in a few strokes.
 */
export const THICKNESSES = [3, 7, 14, 26, 46, 78] as const;
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

/** Which part of a crop frame is being dragged. */
export type CropHandle =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

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
