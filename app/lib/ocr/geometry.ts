// Perspective geometry for the card scanner: corner detection and the warp that
// flattens a hand-held photo into a rectangular card image.
//
// Deliberately dependency-free. OpenCV.js would give the same three primitives
// (findContours / getPerspectiveTransform / warpPerspective) at the cost of an
// ~9 MB WebAssembly download that would have to be self-hosted to satisfy the
// CSP in next.config.ts. The three primitives are ~200 lines here instead.

import type { Point, Quad } from './types';

// --- Homography ------------------------------------------------------------

/**
 * Solve the 3x3 homography H (h8 fixed at 1) mapping the four `from` points
 * onto the four `to` points. Returns the 8 free coefficients.
 *
 * Each correspondence contributes two rows to an 8x8 system, solved by Gaussian
 * elimination with partial pivoting. Returns null for degenerate quads.
 */
export function solveHomography(from: Quad, to: Quad): number[] | null {
  const a: number[][] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k < 9; k++) a[row][k] -= factor * a[col][k];
    }
  }

  return a.map((row, i) => row[8] / a[i][i]);
}

function applyHomography(h: number[], x: number, y: number): Point {
  const denominator = h[6] * x + h[7] * y + 1;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denominator,
    y: (h[3] * x + h[4] * y + h[5]) / denominator,
  };
}

// --- Warp ------------------------------------------------------------------

/**
 * Flatten the quadrilateral `quad` of `source` into an `outWidth` x `outHeight`
 * image, sampling bilinearly.
 *
 * The homography is solved in the *inverse* direction (destination rectangle to
 * source quad) so every output pixel can be filled by a direct lookup — that is
 * what avoids holes, and it avoids inverting a matrix.
 */
export function warpPerspective(
  source: ImageData,
  quad: Quad,
  outWidth: number,
  outHeight: number
): ImageData {
  const destination: Quad = [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ];

  const h = solveHomography(destination, quad);
  const out = new ImageData(outWidth, outHeight);
  if (!h) return out;

  const src = source.data;
  const dst = out.data;
  const maxX = source.width - 1;
  const maxY = source.height - 1;

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const p = applyHomography(h, x + 0.5, y + 0.5);
      const outIndex = (y * outWidth + x) * 4;

      if (p.x < 0 || p.y < 0 || p.x > maxX || p.y > maxY) {
        dst[outIndex] = 255;
        dst[outIndex + 1] = 255;
        dst[outIndex + 2] = 255;
        dst[outIndex + 3] = 255;
        continue;
      }

      const x0 = Math.floor(p.x);
      const y0 = Math.floor(p.y);
      const x1 = Math.min(x0 + 1, maxX);
      const y1 = Math.min(y0 + 1, maxY);
      const fx = p.x - x0;
      const fy = p.y - y0;

      const i00 = (y0 * source.width + x0) * 4;
      const i10 = (y0 * source.width + x1) * 4;
      const i01 = (y1 * source.width + x0) * 4;
      const i11 = (y1 * source.width + x1) * 4;

      for (let channel = 0; channel < 3; channel++) {
        const top = src[i00 + channel] * (1 - fx) + src[i10 + channel] * fx;
        const bottom = src[i01 + channel] * (1 - fx) + src[i11 + channel] * fx;
        dst[outIndex + channel] = top * (1 - fy) + bottom * fy;
      }
      dst[outIndex + 3] = 255;
    }
  }

  return out;
}

/**
 * Aspect ratio implied by a quad, averaging opposite edges. Used to pick the
 * warp target size so the flattened card is not stretched.
 */
export function quadAspectRatio(quad: Quad): number {
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2;
  const height = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2;
  if (height < 1) return 1;
  return width / height;
}

// --- Corner detection ------------------------------------------------------

/** Order four arbitrary points as top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(points: Point[]): Quad {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  // atan2 starts at -PI (pointing left) and increases clockwise in screen
  // coordinates, so rotate until the first point is the top-left one.
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const score = p.x + p.y;
    if (score < best) {
      best = score;
      start = i;
    }
  });
  return [
    sorted[start % 4],
    sorted[(start + 1) % 4],
    sorted[(start + 2) % 4],
    sorted[(start + 3) % 4],
  ];
}

/** Box-average downscale, so corner detection runs on a small image. */
export function downscale(image: ImageData, maxWidth: number): { image: ImageData; scale: number } {
  if (image.width <= maxWidth) return { image, scale: 1 };

  const scale = maxWidth / image.width;
  const width = maxWidth;
  const height = Math.max(1, Math.round(image.height * scale));
  const out = new ImageData(width, height);
  const step = 1 / scale;

  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor(y * step);
    const sy1 = Math.min(image.height, Math.max(sy0 + 1, Math.floor((y + 1) * step)));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor(x * step);
      const sx1 = Math.min(image.width, Math.max(sx0 + 1, Math.floor((x + 1) * step)));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * image.width + sx) * 4;
          r += image.data[i];
          g += image.data[i + 1];
          b += image.data[i + 2];
          count++;
        }
      }
      const o = (y * width + x) * 4;
      out.data[o] = r / count;
      out.data[o + 1] = g / count;
      out.data[o + 2] = b / count;
      out.data[o + 3] = 255;
    }
  }

  return { image: out, scale };
}

function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > best) {
      best = variance;
      threshold = t;
    }
  }

  return threshold;
}

/**
 * Separable binary dilation/erosion, O(1) per pixel via a sliding count.
 */
function morph(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  op: 'dilate' | 'erode'
): Uint8Array {
  const pass = (input: Uint8Array, stride: number, outer: number, inner: number) => {
    const output = new Uint8Array(input.length);
    for (let a = 0; a < outer; a++) {
      const base = stride === 1 ? a * inner : a;
      let count = 0;
      for (let b = 0; b <= Math.min(radius, inner - 1); b++) count += input[base + b * stride];
      for (let b = 0; b < inner; b++) {
        const window = Math.min(inner - 1, b + radius) - Math.max(0, b - radius) + 1;
        output[base + b * stride] = op === 'dilate' ? (count > 0 ? 1 : 0) : count === window ? 1 : 0;
        const leaving = b - radius;
        const entering = b + radius + 1;
        if (leaving >= 0) count -= input[base + leaving * stride];
        if (entering < inner) count += input[base + entering * stride];
      }
    }
    return output;
  };

  return pass(pass(mask, 1, height, width), width, width, height);
}

/**
 * Close the holes the printed grid punches in the card region.
 *
 * Downscaling a 2 px rule to a quarter of its size leaves a mid-grey line that
 * Otsu still calls "dark", which chops the card's bright interior into 60-odd
 * disconnected table cells — a flood fill started in the middle then finds one
 * cell instead of the card. A closing bridges the rules before the fill runs.
 * It cannot make the card leak into the background any more than Otsu already
 * would: the radius is far smaller than the gap to anything outside the card.
 */
function closeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morph(morph(mask, width, height, radius, 'dilate'), width, height, radius, 'erode');
}

function toGray(image: ImageData): Uint8Array {
  const gray = new Uint8Array(image.width * image.height);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    gray[p] = (image.data[i] * 299 + image.data[i + 1] * 587 + image.data[i + 2] * 114) / 1000;
  }
  return gray;
}

/** Convex hull (Andrew's monotone chain). Input is mutated-safe: it is copied. */
function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;

  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (input: Point[]) => {
    const stack: Point[] = [];
    for (const p of input) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) {
        stack.pop();
      }
      stack.push(p);
    }
    stack.pop();
    return stack;
  };

  return [...build(sorted), ...build([...sorted].reverse())];
}

/**
 * Reduce a convex polygon to four vertices by repeatedly dropping the vertex
 * whose removal costs the least area. This is the cheap stand-in for OpenCV's
 * approxPolyDP and is stable on the near-rectangular hulls a card produces.
 */
function reduceToQuad(hull: Point[]): Point[] | null {
  if (hull.length < 4) return null;
  const polygon = [...hull];

  while (polygon.length > 4) {
    let victim = 0;
    let cheapest = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const previous = polygon[(i - 1 + polygon.length) % polygon.length];
      const next = polygon[(i + 1) % polygon.length];
      const area = Math.abs(
        (polygon[i].x - previous.x) * (next.y - previous.y) -
          (polygon[i].y - previous.y) * (next.x - previous.x)
      );
      if (area < cheapest) {
        cheapest = area;
        victim = i;
      }
    }
    polygon.splice(victim, 1);
  }

  return polygon;
}

/**
 * Find the card in a photo.
 *
 * The capture UI draws a guide rectangle, so the card is expected to be the
 * large bright region covering the middle of the frame. That assumption lets a
 * plain Otsu split plus a flood fill from the centre stand in for full contour
 * detection — and when it is wrong the operator drags the corner handles, which
 * is the real safety net.
 *
 * Returns corners in the coordinate space of `image`, or null if nothing
 * card-shaped was found.
 */
export function detectCardQuad(image: ImageData): Quad | null {
  const { image: small, scale } = downscale(image, 400);
  const gray = toGray(small);
  const threshold = otsuThreshold(gray);
  const { width, height } = small;

  const bright = new Uint8Array(width * height);
  for (let i = 0; i < bright.length; i++) bright[i] = gray[i] > threshold ? 1 : 0;
  const card = closeMask(bright, width, height, 2);

  // Flood fill the bright region containing the centre of the frame. If the
  // exact centre pixel is dark (a pen stroke, a printed line), probe outwards.
  const seeds: number[] = [];
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const x = cx + dx * Math.floor(width / 24);
      const y = cy + dy * Math.floor(height / 24);
      if (x >= 0 && y >= 0 && x < width && y < height) seeds.push(y * width + x);
    }
  }

  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  for (const seed of seeds) {
    if (card[seed] && !visited[seed]) {
      visited[seed] = 1;
      stack.push(seed);
      break;
    }
  }
  if (stack.length === 0) return null;

  // Per-row extremes are enough to reconstruct the convex hull of the region.
  // `width` is the sentinel for "no pixel yet" because every real x is below it —
  // an Int32Array cannot hold Number.MAX_SAFE_INTEGER, which truncates to -1 and
  // would silently swallow every left-edge point.
  const rowMin = new Int32Array(height).fill(width);
  const rowMax = new Int32Array(height).fill(-1);
  let area = 0;

  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % width;
    const y = (index - x) / width;
    area++;
    if (x < rowMin[y]) rowMin[y] = x;
    if (x > rowMax[y]) rowMax[y] = x;

    if (x > 0 && !visited[index - 1] && card[index - 1]) {
      visited[index - 1] = 1;
      stack.push(index - 1);
    }
    if (x < width - 1 && !visited[index + 1] && card[index + 1]) {
      visited[index + 1] = 1;
      stack.push(index + 1);
    }
    if (y > 0 && !visited[index - width] && card[index - width]) {
      visited[index - width] = 1;
      stack.push(index - width);
    }
    if (y < height - 1 && !visited[index + width] && card[index + width]) {
      visited[index + width] = 1;
      stack.push(index + width);
    }
  }

  // A region smaller than a fifth of the frame is not the card the guide asked for.
  if (area < width * height * 0.2) return null;

  const boundary: Point[] = [];
  for (let y = 0; y < height; y++) {
    if (rowMax[y] < 0) continue;
    boundary.push({ x: rowMin[y], y });
    boundary.push({ x: rowMax[y], y });
  }

  const quad = reduceToQuad(convexHull(boundary));
  if (!quad || quad.length !== 4) return null;

  return orderQuad(quad.map((p) => ({ x: p.x / scale, y: p.y / scale })));
}
