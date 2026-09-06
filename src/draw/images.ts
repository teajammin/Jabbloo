import { CANVAS_H, CANVAS_W } from './types';

/**
 * Image import for the drawing tool.
 *
 * Uploads are downscaled before anything else touches them: a modern phone
 * camera produces images several times larger than the canvas, and carrying
 * that resolution through a cutout request and into the stroke list wastes
 * both bandwidth and memory for no visible gain.
 */

/** The brief's cap on uploads per drawing. */
export const MAX_UPLOADS = 5;

/** Longest edge kept after import. Comfortably above the canvas' own size. */
const MAX_EDGE = 1400;

export interface ImportedImage {
  data: string;
  w: number;
  h: number;
}

/** Reads a File, downscaling it and normalising to PNG. */
export async function importFile(file: File): Promise<ImportedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return { data: scratch.toDataURL('image/png'), w, h };
}

/** Where an imported image sits on the canvas: centred, scaled to fit. */
export function placeOnCanvas(image: ImportedImage): { x: number; y: number; w: number; h: number } {
  const scale = Math.min((CANVAS_W * 0.8) / image.w, (CANVAS_H * 0.8) / image.h);
  const w = image.w * scale;
  const h = image.h * scale;
  return { x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, w, h };
}

/**
 * Cuts the subject out of an image.
 *
 * Tries the server's Remove.bg proxy first. If no key is configured, or the
 * service fails, falls back to a local cutout so a player is never blocked by
 * a missing credential — the brief's flow depends on this step working.
 */
export async function cutSubject(image: ImportedImage): Promise<ImportedImage> {
  try {
    const response = await fetch('/api/cutout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: image.data }),
    });
    if (response.ok) {
      const body = (await response.json()) as { available?: boolean; image?: string };
      if (body.available && body.image) {
        return await measure(body.image);
      }
    }
  } catch {
    // Fall through to the local cutout.
  }
  return localCutout(image);
}

/**
 * Local fallback: floods inward from the edges, clearing pixels close to the
 * border colour.
 *
 * The same approach used to strip backgrounds from supplied art, and for the
 * same reason: flooding from the outside leaves matching colours INSIDE the
 * subject intact, where a global colour key would punch holes through it.
 *
 * Nowhere near Remove.bg on a busy photo, but reliable on the flat or plain
 * backgrounds people usually shoot against, and it never fails.
 */
export async function localCutout(image: ImportedImage, tolerance = 42): Promise<ImportedImage> {
  const bitmap = await createImageBitmap(await (await fetch(image.data)).blob());
  const { width: w, height: h } = bitmap;

  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const frame = ctx.getImageData(0, 0, w, h);
  const data = frame.data;

  // Reference colour is the average of the four corners, which is far more
  // robust than any single pixel on a slightly vignetted photo.
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const;
  let br = 0, bg = 0, bb = 0;
  for (const [cx, cy] of corners) {
    const i = (cy * w + cx) * 4;
    br += data[i]!; bg += data[i + 1]!; bb += data[i + 2]!;
  }
  br /= 4; bg /= 4; bb /= 4;

  const near = (i: number) =>
    Math.abs(data[i]! - br) <= tolerance &&
    Math.abs(data[i + 1]! - bg) <= tolerance &&
    Math.abs(data[i + 2]! - bb) <= tolerance;

  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x, 0); stack.push(x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y); stack.push(w - 1, y); }

  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const p = y * w + x;
    if (seen[p]) continue;
    const i = p * 4;
    if (!near(i)) continue;
    seen[p] = 1;
    data[i + 3] = 0;
    if (x > 0) stack.push(x - 1, y);
    if (x < w - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < h - 1) stack.push(x, y + 1);
  }

  ctx.putImageData(frame, 0, 0);
  return { data: scratch.toDataURL('image/png'), w, h };
}

async function measure(dataUrl: string): Promise<ImportedImage> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const out = { data: dataUrl, w: bitmap.width, h: bitmap.height };
  bitmap.close();
  return out;
}

// ---------------------------------------------------------------- cropping

export type MaskShape = 'circle' | 'triangle' | 'star' | 'heart';

/** Loads a data URL into a bitmap. */
async function toBitmap(dataUrl: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

/**
 * Clips an image to a shape, keeping everything outside it transparent.
 *
 * The shape is inscribed in the image's own bounds rather than made square, so
 * a wide photo gets a wide oval instead of a circle with the sides thrown away.
 */
export async function maskImage(dataUrl: string, shape: MaskShape): Promise<string> {
  const bitmap = await toBitmap(dataUrl);
  const w = bitmap.width;
  const h = bitmap.height;

  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      break;
    case 'heart': {
      // Two lobes over a point, scaled to the image box.
      const s = Math.min(w, h);
      ctx.moveTo(w / 2, h * 0.92);
      ctx.bezierCurveTo(-s * 0.3, h * 0.42, w * 0.18, -h * 0.08, w / 2, h * 0.26);
      ctx.bezierCurveTo(w - w * 0.18, -h * 0.08, w + s * 0.3, h * 0.42, w / 2, h * 0.92);
      ctx.closePath();
      break;
    }
    case 'star': {
      const points = 5;
      const cx = w / 2;
      const cy = h / 2;
      const outerX = w / 2;
      const outerY = h / 2;
      const inner = 0.42;
      for (let i = 0; i < points * 2; i++) {
        const scale = i % 2 === 0 ? 1 : inner;
        // Start at the top: rotate a quarter turn back from east.
        const angle = (i * Math.PI) / points - Math.PI / 2;
        const x = cx + Math.cos(angle) * outerX * scale;
        const y = cy + Math.sin(angle) * outerY * scale;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
  }
  ctx.clip();
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return scratch.toDataURL('image/png');
}

/**
 * Crops an image to a sub-rectangle, given in fractions of its own size.
 *
 * Fractions rather than pixels because the caller works in canvas coordinates
 * while the source keeps its own resolution, and converting once here avoids
 * every call site having to know both.
 */
export async function cropImage(
  dataUrl: string,
  fx: number, fy: number, fw: number, fh: number,
): Promise<string> {
  const bitmap = await toBitmap(dataUrl);
  const sx = Math.max(0, Math.round(fx * bitmap.width));
  const sy = Math.max(0, Math.round(fy * bitmap.height));
  const sw = Math.max(1, Math.round(fw * bitmap.width));
  const sh = Math.max(1, Math.round(fh * bitmap.height));

  const scratch = document.createElement('canvas');
  scratch.width = sw;
  scratch.height = sh;
  const ctx = scratch.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  return scratch.toDataURL('image/png');
}
