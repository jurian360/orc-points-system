// Ink extraction for the controlekaart.
//
// Three kinds of marks share every cell: the printed grid (thin, near-black),
// the participant's pen (blue/black, thick), and the officials' orange/red
// stamps. The stamps are the reason a naive threshold fails — they are as dark
// as pen ink in luminance, so they have to be removed on *hue*, before any
// binarisation happens.

import type { Rect } from './types';

/** Hue band (degrees) that counts as stamp ink. Orange through red, wrapping 0. */
const STAMP_HUE_LOW = 335;
const STAMP_HUE_HIGH = 30;
const STAMP_MIN_SATURATION = 0.32;
const STAMP_MIN_VALUE = 0.22;

/** Bradley adaptive threshold: window is 1/16 of the image width, bias 15%. */
const ADAPTIVE_WINDOW_DIVISOR = 16;
const ADAPTIVE_BIAS = 0.15;

export interface InkMask {
  width: number;
  height: number;
  /** 1 where pen ink was found. */
  ink: Uint8Array;
  /** 1 where an orange/red stamp was found. */
  stamp: Uint8Array;
}

function hue(r: number, g: number, b: number, max: number, min: number): number {
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * Split an image into pen ink and stamp ink.
 *
 * Stamp pixels are classified first and then excluded from the ink mask, so a
 * stamped cell comes back empty instead of coming back as a garbage letter.
 */
export function buildInkMask(image: ImageData): InkMask {
  const { width, height, data } = image;
  const pixels = width * height;
  const gray = new Uint8Array(pixels);
  const stamp = new Uint8Array(pixels);

  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const h = hue(r, g, b, max, min);

    const isStampHue = h >= STAMP_HUE_LOW || h <= STAMP_HUE_HIGH;
    if (isStampHue && saturation >= STAMP_MIN_SATURATION && max >= STAMP_MIN_VALUE) {
      stamp[p] = 1;
      // Erase the stamp before thresholding, so it cannot pull the local mean
      // down and drag neighbouring paper into the ink mask.
      gray[p] = 255;
    } else {
      gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
  }

  // Integral image for the windowed mean.
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }

  const radius = Math.max(2, Math.floor(width / ADAPTIVE_WINDOW_DIVISOR / 2));
  const ink = new Uint8Array(pixels);

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (stamp[p]) continue;

      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (width + 1) + (x1 + 1)] -
        integral[y0 * (width + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];

      const mean = sum / count;
      if (gray[p] < mean * (1 - ADAPTIVE_BIAS)) ink[p] = 1;
    }
  }

  return { width, height, ink, stamp };
}

/** Fraction of a rectangle covered by a mask. */
export function maskCoverage(mask: Uint8Array, width: number, rect: Rect): number {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.round(rect.x + rect.w);
  const y1 = Math.round(rect.y + rect.h);
  let count = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      total++;
      if (mask[y * width + x]) count++;
    }
  }
  return total === 0 ? 0 : count / total;
}

export interface CellBitmap {
  /** Normalised, padded, black-on-white bitmap ready for the recogniser. */
  canvas: HTMLCanvasElement;
  inkFraction: number;
  stampFraction: number;
}

/**
 * Cut one cell out of the flattened card and normalise it for OCR.
 *
 * The normalisation is what makes a printed-text engine usable on handwriting:
 * the cell is inset to drop the printed rules, reduced to its ink bounding box,
 * scaled to a fixed glyph height and centred on a white square with a wide
 * quiet zone. Tesseract's layout analysis then has nothing left to get wrong.
 *
 * Returns null when the cell holds no pen ink.
 */
export function extractCell(
  mask: InkMask,
  rect: Rect,
  options: { insetFraction?: number; targetGlyphHeight?: number; padding?: number } = {}
): CellBitmap | null {
  const inset = options.insetFraction ?? 0.14;
  const targetGlyphHeight = options.targetGlyphHeight ?? 56;
  const padding = options.padding ?? 24;

  const insetRect: Rect = {
    x: rect.x + rect.w * inset,
    y: rect.y + rect.h * inset,
    w: rect.w * (1 - inset * 2),
    h: rect.h * (1 - inset * 2),
  };

  const x0 = Math.max(0, Math.round(insetRect.x));
  const y0 = Math.max(0, Math.round(insetRect.y));
  const x1 = Math.min(mask.width, Math.round(insetRect.x + insetRect.w));
  const y1 = Math.min(mask.height, Math.round(insetRect.y + insetRect.h));
  if (x1 <= x0 || y1 <= y0) return null;

  const cellArea = (x1 - x0) * (y1 - y0);
  let inkCount = 0;
  let stampCount = 0;
  let minX = x1;
  let minY = y1;
  let maxX = x0;
  let maxY = y0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * mask.width + x;
      if (mask.stamp[p]) stampCount++;
      if (!mask.ink[p]) continue;
      inkCount++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const inkFraction = inkCount / cellArea;
  const stampFraction = stampCount / cellArea;

  // Too little ink is an empty box; too much is a smudge, a shadow or a stamp
  // the hue filter did not catch. Neither is worth an OCR round trip.
  if (inkFraction < 0.012 || inkFraction > 0.6 || maxX < minX) return null;

  const glyphWidth = maxX - minX + 1;
  const glyphHeight = maxY - minY + 1;
  const scale = targetGlyphHeight / glyphHeight;
  const drawWidth = Math.max(1, Math.round(glyphWidth * scale));
  const drawHeight = Math.max(1, Math.round(glyphHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = drawWidth + padding * 2;
  canvas.height = drawHeight + padding * 2;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const glyph = new ImageData(glyphWidth, glyphHeight);
  for (let y = 0; y < glyphHeight; y++) {
    for (let x = 0; x < glyphWidth; x++) {
      const value = mask.ink[(minY + y) * mask.width + (minX + x)] ? 0 : 255;
      const i = (y * glyphWidth + x) * 4;
      glyph.data[i] = value;
      glyph.data[i + 1] = value;
      glyph.data[i + 2] = value;
      glyph.data[i + 3] = 255;
    }
  }

  // Round-trip through a scratch canvas so drawImage can do the smooth upscale;
  // putImageData ignores transforms.
  const scratch = document.createElement('canvas');
  scratch.width = glyphWidth;
  scratch.height = glyphHeight;
  scratch.getContext('2d')?.putImageData(glyph, 0, 0);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(scratch, padding, padding, drawWidth, drawHeight);

  return { canvas, inkFraction, stampFraction };
}

/**
 * Cut a wider region (the header fields) out of the card as plain greyscale.
 * These hold printed labels next to handwriting, so they go to the recogniser
 * as a line rather than as a single normalised glyph.
 */
export function extractStrip(image: ImageData, mask: InkMask, rect: Rect): HTMLCanvasElement | null {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(image.width, Math.round(rect.x + rect.w));
  const y1 = Math.min(image.height, Math.round(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return null;

  const width = x1 - x0;
  const height = y1 - y0;
  const strip = new ImageData(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = mask.ink[(y0 + y) * mask.width + (x0 + x)] ? 0 : 255;
      const i = (y * width + x) * 4;
      strip.data[i] = value;
      strip.data[i + 1] = value;
      strip.data[i + 2] = value;
      strip.data[i + 3] = 255;
    }
  }

  const scale = Math.min(4, Math.max(1, 80 / height));
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  scratch.getContext('2d')?.putImageData(strip, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale) + 32;
  canvas.height = Math.round(height * scale) + 32;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(scratch, 16, 16, Math.round(width * scale), Math.round(height * scale));

  return canvas;
}
