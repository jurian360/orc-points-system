// Turning a camera frame or a picked file into the ImageData the pipeline wants,
// and rendering results back onto a canvas for review.

import type { Quad, Rect, ScanGrid } from './types';

/**
 * Longest edge kept from a capture. Phone cameras hand back 12 MP frames; the
 * warp only needs enough resolution for ~35 px tall letters, and every extra
 * megapixel is main-thread time in the corner detector.
 */
export const MAX_CAPTURE_WIDTH = 2000;

function drawScaled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number
): ImageData {
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context unavailable');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

export function imageDataFromVideo(video: HTMLVideoElement): ImageData {
  return drawScaled(video, video.videoWidth, video.videoHeight, MAX_CAPTURE_WIDTH);
}

export async function imageDataFromFile(file: File): Promise<ImageData> {
  // `imageOrientation: 'from-image'` applies the EXIF rotation phones write
  // instead of baking it in — without it, portrait-held captures arrive sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return drawScaled(bitmap, bitmap.width, bitmap.height, MAX_CAPTURE_WIDTH);
  } finally {
    bitmap.close();
  }
}

export function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(image, 0, 0);
  return canvas;
}

export function imageDataToDataUrl(image: ImageData): string {
  return imageDataToCanvas(image).toDataURL('image/jpeg', 0.85);
}

/** The guide rectangle, used as the starting quad when auto-detection fails. */
export function defaultQuad(width: number, height: number, inset = 0.06): Quad {
  const x0 = width * inset;
  const x1 = width * (1 - inset);
  const y0 = height * inset;
  const y1 = height * (1 - inset);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/**
 * Draw the flattened card with its detected cells outlined.
 *
 * This is the fastest way for an operator to tell a misread from a misaligned
 * grid, which are the two failure modes with completely different fixes.
 */
export function drawGridOverlay(
  canvas: HTMLCanvasElement,
  warped: ImageData,
  grid: ScanGrid
): void {
  canvas.width = warped.width;
  canvas.height = warped.height;
  const context = canvas.getContext('2d');
  if (!context) return;

  context.putImageData(warped, 0, 0);
  context.lineWidth = Math.max(1, warped.width / 800);

  const outline = (rect: Rect, colour: string) => {
    context.strokeStyle = colour;
    context.strokeRect(rect.x, rect.y, rect.w, rect.h);
  };

  grid.orc.forEach((row) => row.forEach((rect) => outline(rect, 'rgba(16,185,129,0.85)')));
  grid.time.forEach((row) => {
    outline(row.ipt, 'rgba(59,130,246,0.85)');
    outline(row.wpt, 'rgba(59,130,246,0.85)');
    outline(row.plusMinus, 'rgba(59,130,246,0.85)');
  });
  outline(grid.controlekaartNo, 'rgba(249,115,22,0.9)');
  outline(grid.eqNo, 'rgba(249,115,22,0.9)');
}
