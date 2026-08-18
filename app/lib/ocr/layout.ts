// Locating the controlekaart's grid inside a flattened card image.
//
// Cell positions are found *structurally* — by detecting the printed rules —
// rather than by trusting fixed proportions. Fixed proportions are only the
// fallback, because a 1% vertical error accumulates into a whole row by the
// time you reach ORC row 30.
//
// Two features do the work:
//
//  * Longest ink run. A printed rule is a nearly unbroken dark line spanning its
//    whole table or block; a filled header bar or a heavy pen stroke is not. Run
//    length separates them where a simple dark-pixel count does not.
//  * Even spacing. The 15 ORC rows (and the 10 time rows) are equally tall, so
//    the row separators form an arithmetic progression. Picking the longest
//    evenly spaced run of detected lines discards the header rules, the TOTAAL
//    rule and any stray line without needing to know how many headers a
//    particular card printing has.

import type { Rect, ScanGrid } from './types';
import type { InkMask } from './preprocess';

export const ORC_ROWS = 30;
export const ORC_ROWS_PER_BLOCK = 15;
export const LETTER_COLUMNS = 4;
export const TIME_ROWS = 10;

/** Cells per block, left to right: ORC 1-15, ORC 16-30, official use. */
const ORC_BLOCK_CELLS = 1 + LETTER_COLUMNS + 1; // NR + 4 letters + STRAFP
const TIME_BLOCK_CELLS = 5; // NR + IPT + WPT + +/- + STRAFP
const LINES_FOR_SCANNED_BLOCKS = ORC_BLOCK_CELLS * 2 + TIME_BLOCK_CELLS + 1; // 18

// Fallback proportions, measured off a SARK controlekaart. Only used when line
// detection fails; the review step draws the grid so a bad fallback is visible.
const NOMINAL = {
  blockX: [0, 0.246, 0.496, 0.773] as const,
  orcColumns: [0.126, 0.153, 0.153, 0.153, 0.153, 0.262] as const,
  timeColumns: [0.142, 0.168, 0.261, 0.149, 0.28] as const,
  rowsTop: 0.078,
  rowsBottom: 0.94,
};

// Header fields sit above the table, as a fraction of the whole card.
const HEADER_FIELDS = {
  controlekaartNo: { x: 0.3, y: 0.045, w: 0.1, h: 0.075 },
  eqNo: { x: 0.78, y: 0.04, w: 0.13, h: 0.08 },
};

// --- Line detection --------------------------------------------------------

// Corner estimation is never exact, so a rule that was horizontal on paper is
// still sheared by a fraction of a degree after warping. Half a degree over a
// 1400 px rule is a 12 px drift — enough to shatter it into ~300 px fragments
// and hide the table's own border below every row separator.
//
// The fix is to dilate the mask along the axis perpendicular to the rules being
// looked for, by rather more than the expected drift, before measuring runs. A
// symmetric dilation does not move the centre of a group, so cell positions stay
// unbiased; it only makes a sheared rule read as one long feature again.
const DILATION_FRACTION = 0.007;

interface RuleMasks {
  width: number;
  height: number;
  /** Dilated vertically — use when looking for horizontal rules. */
  horizontal: Uint8Array;
  /** Dilated horizontally — use when looking for vertical rules. */
  vertical: Uint8Array;
}

/** Sliding-window dilation along one axis, O(1) per pixel. */
function dilate(mask: InkMask, radius: number, axis: 'vertical' | 'horizontal'): Uint8Array {
  const { width, height, ink } = mask;
  const out = new Uint8Array(width * height);
  const outer = axis === 'vertical' ? width : height;
  const inner = axis === 'vertical' ? height : width;
  const stride = axis === 'vertical' ? width : 1;

  for (let a = 0; a < outer; a++) {
    const base = axis === 'vertical' ? a : a * width;
    let count = 0;
    for (let b = 0; b <= Math.min(radius, inner - 1); b++) count += ink[base + b * stride];
    for (let b = 0; b < inner; b++) {
      if (count > 0) out[base + b * stride] = 1;
      const leaving = b - radius;
      const entering = b + radius + 1;
      if (leaving >= 0) count -= ink[base + leaving * stride];
      if (entering < inner) count += ink[base + entering * stride];
    }
  }

  return out;
}

function buildRuleMasks(mask: InkMask): RuleMasks {
  const radius = Math.max(1, Math.round(Math.min(mask.width, mask.height) * DILATION_FRACTION));
  return {
    width: mask.width,
    height: mask.height,
    horizontal: dilate(mask, radius, 'vertical'),
    vertical: dilate(mask, radius, 'horizontal'),
  };
}

/**
 * Longest run of set pixels along `axis` within `box`, per line.
 *
 * A two-pixel break is tolerated so a rule survives the pen strokes and folds
 * that cross it.
 */
function scanRuns(
  masks: RuleMasks,
  box: Rect,
  axis: 'row' | 'column'
): Int32Array {
  const source = axis === 'row' ? masks.horizontal : masks.vertical;
  const x0 = Math.max(0, Math.round(box.x));
  const x1 = Math.min(masks.width, Math.round(box.x + box.w));
  const y0 = Math.max(0, Math.round(box.y));
  const y1 = Math.min(masks.height, Math.round(box.y + box.h));

  const [outerStart, outerEnd] = axis === 'row' ? [y0, y1] : [x0, x1];
  const [innerStart, innerEnd] = axis === 'row' ? [x0, x1] : [y0, y1];
  const runs = new Int32Array(axis === 'row' ? masks.height : masks.width);

  for (let a = outerStart; a < outerEnd; a++) {
    let current = 0;
    let best = 0;
    let gap = 0;
    for (let b = innerStart; b < innerEnd; b++) {
      const index = axis === 'row' ? a * masks.width + b : b * masks.width + a;
      if (source[index]) {
        current += gap + 1;
        gap = 0;
        if (current > best) best = current;
      } else if (gap < 2) {
        gap++;
      } else {
        current = 0;
        gap = 0;
      }
    }
    runs[a] = best;
  }

  return runs;
}

const verticalRuns = (masks: RuleMasks, box: Rect) => scanRuns(masks, box, 'column');
const horizontalRuns = (masks: RuleMasks, box: Rect) => scanRuns(masks, box, 'row');

/**
 * Threshold for "this is a full-length rule", set relative to the longest run
 * actually seen rather than to the image size.
 *
 * The table's own borders are the longest features on the card, so scaling off
 * the maximum keeps them separable from the row separators — which reach at most
 * three quarters of the width — even when the operator's quad clips a few
 * millimetres off an edge, or when shear costs every rule the same few percent.
 */
function ruleThreshold(runs: Int32Array, span: number): number {
  let longest = 0;
  for (let i = 0; i < runs.length; i++) if (runs[i] > longest) longest = runs[i];
  return Math.max(span * 0.5, longest * 0.85);
}

/** Collapse contiguous above-threshold positions into one centre each. */
function groupPeaks(runs: Int32Array, threshold: number, from: number, to: number): number[] {
  const centres: number[] = [];
  let start = -1;

  for (let i = from; i < to; i++) {
    const isPeak = runs[i] >= threshold;
    if (isPeak && start < 0) start = i;
    if (!isPeak && start >= 0) {
      centres.push((start + i - 1) / 2);
      start = -1;
    }
  }
  if (start >= 0) centres.push((start + to - 1) / 2);

  return centres;
}

/**
 * Longest subsequence of `positions` at a constant pitch.
 *
 * Returns the run itself. `minPitch` rejects the degenerate answer of picking
 * two adjacent edges of the same thick rule.
 */
function longestEvenRun(positions: number[], minPitch: number): number[] {
  let best: number[] = [];

  for (let i = 0; i < positions.length - 1; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const pitch = positions[j] - positions[i];
      if (pitch < minPitch) continue;

      const tolerance = Math.max(3, pitch * 0.22);
      const run = [positions[i], positions[j]];
      let expected = positions[j] + pitch;
      let misses = 0;

      for (let k = j + 1; k < positions.length && misses < 2; ) {
        if (Math.abs(positions[k] - expected) <= tolerance) {
          run.push(positions[k]);
          expected = positions[k] + pitch;
          misses = 0;
          k++;
        } else if (positions[k] < expected - tolerance) {
          k++; // extra line between separators — skip it
        } else {
          expected += pitch; // a separator was missed — keep the cadence
          misses++;
        }
      }

      if (run.length > best.length) best = run;
    }
  }

  return best;
}

/** Evenly spaced boundaries as a fallback when the rules could not be read. */
function evenBoundaries(start: number, end: number, count: number): number[] {
  const step = (end - start) / count;
  return Array.from({ length: count + 1 }, (_, i) => start + step * i);
}

// --- Table location --------------------------------------------------------

function findTableBox(masks: RuleMasks): Rect | null {
  const card: Rect = { x: 0, y: 0, w: masks.width, h: masks.height };
  const margin = Math.round(masks.height * 0.02);

  const hRuns = horizontalRuns(masks, card);
  const horizontal = groupPeaks(
    hRuns,
    ruleThreshold(hRuns, masks.width),
    margin,
    masks.height - margin
  );
  if (horizontal.length < 2) return null;

  const top = horizontal[0];
  const bottom = horizontal[horizontal.length - 1];
  if (bottom - top < masks.height * 0.35) return null;

  const band: Rect = { x: 0, y: top, w: masks.width, h: bottom - top };
  const vRuns = verticalRuns(masks, band);
  const vertical = groupPeaks(
    vRuns,
    ruleThreshold(vRuns, bottom - top),
    margin,
    masks.width - margin
  );
  if (vertical.length < 2) return null;

  const left = vertical[0];
  const right = vertical[vertical.length - 1];
  if (right - left < masks.width * 0.5) return null;

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Column boundaries for the three blocks we scan, as 18 x-positions:
 * ORC 1-15 (7 lines), ORC 16-30 (6 more), official use (5 more).
 *
 * The MERK block's internal rules stop at the TOTAAL STRAFPUNTEN box, so it
 * contributes an unpredictable number of extra lines on the right — hence the
 * tolerance on the total count and the use of only the first 18.
 */
function findColumnLines(masks: RuleMasks, table: Rect): number[] | null {
  const runs = verticalRuns(masks, table);
  const from = Math.round(table.x) - 3;
  const to = Math.round(table.x + table.w) + 3;

  for (const ratio of [0.9, 0.85, 0.8, 0.72, 0.65]) {
    const lines = groupPeaks(runs, table.h * ratio, Math.max(0, from), Math.min(masks.width, to));
    if (lines.length >= LINES_FOR_SCANNED_BLOCKS + 1 && lines.length <= 23) {
      return lines.slice(0, LINES_FOR_SCANNED_BLOCKS);
    }
  }

  return null;
}

function nominalColumnLines(table: Rect): number[] {
  const lines: number[] = [];
  let x = table.x + table.w * NOMINAL.blockX[0];

  for (let block = 0; block < 3; block++) {
    const blockStart = table.x + table.w * NOMINAL.blockX[block];
    const blockEnd = table.x + table.w * (NOMINAL.blockX[block + 1] ?? 1);
    const widths = block < 2 ? NOMINAL.orcColumns : NOMINAL.timeColumns;
    x = blockStart;
    lines.push(x);
    for (const width of widths) {
      x += (blockEnd - blockStart) * width;
      lines.push(x);
    }
    lines.pop(); // the block's right edge is the next block's left edge
  }

  lines.push(table.x + table.w * NOMINAL.blockX[3]);
  return lines;
}

/**
 * Pick the window of `count` consecutive boundaries that best matches `band`.
 *
 * An evenly spaced run usually has one more line than the rows need — the rule
 * under the header above it, the TOTAAL rule below it — and for the ten time
 * rows the header band happens to be almost exactly one row tall, so the run
 * extends upwards by one and every value lands a row too high. Anchoring to the
 * band the ORC rows already established removes the ambiguity.
 */
function alignToBand(run: number[], count: number, band: [number, number]): number[] {
  let best = run.slice(0, count);
  let bestCost = Infinity;

  for (let start = 0; start + count <= run.length; start++) {
    const cost =
      Math.abs(run[start] - band[0]) + Math.abs(run[start + count - 1] - band[1]);
    if (cost < bestCost) {
      bestCost = cost;
      best = run.slice(start, start + count);
    }
  }

  return best;
}

/**
 * Row boundaries for one block, from its own horizontal rules.
 *
 * Without a `band`, the earliest window of the run is taken: on this card the
 * header is two rules tall, so the first evenly spaced line is the top of row 1
 * and any surplus line is the TOTAAL rule at the bottom.
 */
function findRowLines(
  masks: RuleMasks,
  table: Rect,
  left: number,
  right: number,
  rowCount: number,
  band?: [number, number]
): number[] | null {
  const block: Rect = { x: left, y: table.y, w: right - left, h: table.h };
  const runs = horizontalRuns(masks, block);
  const minPitch = (table.h / (rowCount + 4)) * 0.5;

  for (const ratio of [0.85, 0.75, 0.65]) {
    const candidates = groupPeaks(
      runs,
      block.w * ratio,
      Math.round(table.y) - 3,
      Math.round(table.y + table.h) + 3
    );
    const run = longestEvenRun(candidates, minPitch);
    if (run.length >= rowCount + 1) {
      return band ? alignToBand(run, rowCount + 1, band) : run.slice(0, rowCount + 1);
    }
  }

  return null;
}

function nominalRowLines(table: Rect, rowCount: number): number[] {
  return evenBoundaries(
    table.y + table.h * NOMINAL.rowsTop,
    table.y + table.h * NOMINAL.rowsBottom,
    rowCount
  );
}

// --- Grid assembly ---------------------------------------------------------

const rectFrom = (x0: number, x1: number, y0: number, y1: number): Rect => ({
  x: x0,
  y: y0,
  w: x1 - x0,
  h: y1 - y0,
});

export interface GridResult {
  grid: ScanGrid;
  /** False when any part of the layout fell back to nominal proportions. */
  detected: boolean;
  table: Rect;
}

/**
 * Build the full cell map for a flattened card.
 *
 * Falls back progressively: a missing table box means nominal everything, a
 * missing column set means nominal columns with detected rows, and so on.
 */
export function buildGrid(mask: InkMask): GridResult {
  const card: Rect = { x: 0, y: 0, w: mask.width, h: mask.height };
  const masks = buildRuleMasks(mask);
  const detectedTable = findTableBox(masks);
  const table = detectedTable ?? {
    x: card.w * 0.07,
    y: card.h * 0.13,
    w: card.w * 0.89,
    h: card.h * 0.83,
  };

  const detectedColumns = detectedTable ? findColumnLines(masks, table) : null;
  const columns = detectedColumns ?? nominalColumnLines(table);
  let detected = Boolean(detectedTable && detectedColumns);

  const blockBounds = [
    { left: columns[0], right: columns[ORC_BLOCK_CELLS], rows: ORC_ROWS_PER_BLOCK },
    { left: columns[ORC_BLOCK_CELLS], right: columns[ORC_BLOCK_CELLS * 2], rows: ORC_ROWS_PER_BLOCK },
    { left: columns[ORC_BLOCK_CELLS * 2], right: columns[LINES_FOR_SCANNED_BLOCKS - 1], rows: TIME_ROWS },
  ];

  // The three blocks share one vertical band — 15 ORC rows, 15 more, and 10 time
  // rows all span the same height on the card. The ORC block resolves that band
  // most reliably because its pitch is the finest, so it goes first and the rest
  // are anchored to what it found.
  const rowLines: number[][] = [];
  let band: [number, number] | undefined;

  blockBounds.forEach((block) => {
    const found = detectedTable
      ? findRowLines(masks, table, block.left, block.right, block.rows, band)
      : null;

    if (!found) {
      detected = false;
      rowLines.push(band ? evenBoundaries(band[0], band[1], block.rows) : nominalRowLines(table, block.rows));
      return;
    }

    band = band ?? [found[0], found[found.length - 1]];
    rowLines.push(found);
  });

  const orc: Rect[][] = [];
  for (let block = 0; block < 2; block++) {
    for (let row = 0; row < ORC_ROWS_PER_BLOCK; row++) {
      const y0 = rowLines[block][row];
      const y1 = rowLines[block][row + 1];
      const cells: Rect[] = [];
      for (let column = 0; column < LETTER_COLUMNS; column++) {
        // +1 skips the NR column at the start of each block.
        const index = block * ORC_BLOCK_CELLS + 1 + column;
        cells.push(rectFrom(columns[index], columns[index + 1], y0, y1));
      }
      orc.push(cells);
    }
  }

  const timeBase = ORC_BLOCK_CELLS * 2;
  const time = Array.from({ length: TIME_ROWS }, (_, row) => {
    const y0 = rowLines[2][row];
    const y1 = rowLines[2][row + 1];
    return {
      ipt: rectFrom(columns[timeBase + 1], columns[timeBase + 2], y0, y1),
      wpt: rectFrom(columns[timeBase + 2], columns[timeBase + 3], y0, y1),
      plusMinus: rectFrom(columns[timeBase + 3], columns[timeBase + 4], y0, y1),
    };
  });

  const headerRect = (field: { x: number; y: number; w: number; h: number }): Rect => ({
    x: card.w * field.x,
    y: card.h * field.y,
    w: card.w * field.w,
    h: card.h * field.h,
  });

  return {
    grid: {
      orc,
      time,
      controlekaartNo: headerRect(HEADER_FIELDS.controlekaartNo),
      eqNo: headerRect(HEADER_FIELDS.eqNo),
    },
    detected,
    table,
  };
}
