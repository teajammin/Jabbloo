/**
 * Drawing model.
 *
 * Strokes are stored as data, not baked into pixels, so undo is exact, the
 * canvas can be re-rendered at any resolution, and a finished drawing can be
 * sent over the network as JSON rather than a bitmap.
 */

export type ToolName = 'pen' | 'eraser' | 'fill' | 'rect' | 'ellipse' | 'line';

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
}

export interface FillStroke {
  kind: 'fill';
  tool: 'fill';
  colour: string;
  at: Point;
}

export type Stroke = FreehandStroke | ShapeStroke | FillStroke;

/** The canvas' logical size. Drawings are stored at this resolution. */
export const CANVAS_W = 1024;
export const CANVAS_H = 1024;
