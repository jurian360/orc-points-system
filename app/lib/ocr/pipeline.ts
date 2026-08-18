// The scan pipeline: photo in, controlekaart fields out.
//
//   warp -> ink mask (stamps removed) -> grid detection -> per-cell OCR
//
// Every step is deliberately independent of the recogniser, and every step
// leaves its output inspectable: the warped image and the grid come back in the
// result so the review screen can draw the detected cells over the card. An
// operator who can see the grid can tell in one glance whether a bad read is a
// misaligned cell or a genuinely unreadable character.

import { quadAspectRatio, warpPerspective } from './geometry';
import { buildGrid, LETTER_COLUMNS, ORC_ROWS, TIME_ROWS } from './layout';
import { buildInkMask, extractCell, extractStrip, maskCoverage } from './preprocess';
import type { Recognizer, RecognizeKind } from './recognizer';
import type {
  CellResult,
  Quad,
  Rect,
  ScanProgress,
  ScanResult,
  TimeRowResult,
} from './types';
import { emptyCell } from './types';

/** Long edge of the flattened card. Enough for ~35 px tall letter cells. */
const WARP_WIDTH = 1600;
const MIN_ASPECT = 1.15;
const MAX_ASPECT = 1.8;

/** Above this share of stamp ink a cell is reported as stamped, never as a letter. */
const STAMP_THRESHOLD = 0.04;

// --- Value normalisation ---------------------------------------------------

/** Reduce a raw read to the single uppercase letter a cell can hold. */
export function normalizeLetter(raw: string): { text: string; penalty: number } {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length === 0) return { text: '', penalty: 1 };
  // More than one candidate letter in a one-character box means the segmentation
  // or the read is shaky, so the value is kept but flagged for review.
  return { text: letters[0], penalty: letters.length > 1 ? 0.35 : 0 };
}

/**
 * Normalise a passage time to 24-hour HH:MM.
 *
 * Officials write these as `9.40`, `940` or `09:40` interchangeably, so the
 * separator is discarded and the digits are re-formatted. An out-of-range value
 * is still returned — the operator is better placed to fix `19:70` than we are —
 * but it is flagged.
 */
export function normalizeTime(raw: string): { text: string; penalty: number } {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return { text: '', penalty: 1 };
  if (digits.length < 3) return { text: digits, penalty: 0.5 };

  const clipped = digits.slice(0, 4);
  const padded = clipped.length === 3 ? `0${clipped}` : clipped;
  const hours = Number(padded.slice(0, 2));
  const minutes = Number(padded.slice(2, 4));
  const outOfRange = hours > 23 || minutes > 59;

  return {
    text: `${padded.slice(0, 2)}:${padded.slice(2, 4)}`,
    penalty: (digits.length > 4 ? 0.3 : 0) + (outOfRange ? 0.5 : 0),
  };
}

/** The +/- column holds a signed difference, not a clock time. */
export function normalizePlusMinus(raw: string): { text: string; penalty: number } {
  const cleaned = raw.replace(/[^0-9:.+-]/g, '');
  if (cleaned.length === 0) return { text: '', penalty: 1 };
  return { text: cleaned, penalty: 0 };
}

export function normalizeCardNumber(raw: string): { text: string; penalty: number } {
  const cleaned = raw.toUpperCase().replace(/[^IVX0-9]/g, '');
  return { text: cleaned, penalty: cleaned.length === 0 ? 1 : 0 };
}

export function normalizeEqNumber(raw: string): { text: string; penalty: number } {
  const digits = raw.replace(/\D/g, '').slice(0, 3);
  const value = Number(digits);
  const outOfRange = digits.length === 0 || value < 1 || value > 100;
  return { text: digits, penalty: outOfRange ? 1 : 0 };
}

// --- Pipeline --------------------------------------------------------------

export interface ScanOptions {
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
}

const report = (options: ScanOptions, phase: ScanProgress['phase'], ratio: number, message: string) =>
  options.onProgress?.({ phase, ratio, message });

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
}

/** Let the browser paint between cells — this runs on the main thread. */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function scanScorecard(
  source: ImageData,
  quad: Quad,
  recognizer: Recognizer,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const { signal } = options;

  report(options, 'warping', 0, 'Flattening the card…');
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, quadAspectRatio(quad)));
  const warped = warpPerspective(source, quad, WARP_WIDTH, Math.round(WARP_WIDTH / aspect));
  throwIfAborted(signal);

  report(options, 'locating-grid', 0, 'Finding the grid…');
  const mask = buildInkMask(warped);
  const { grid, detected } = buildGrid(mask);
  throwIfAborted(signal);

  report(options, 'loading-ocr', 0, 'Loading the OCR engine…');
  await recognizer.init((ratio) => report(options, 'loading-ocr', ratio, 'Loading the OCR engine…'));
  throwIfAborted(signal);

  // Only cells holding pen ink are sent to OCR — on a typical card that is
  // ~30 of 150, which is the difference between a 3-second and a 20-second scan.
  const readCell = async (rect: Rect, kind: RecognizeKind): Promise<CellResult> => {
    const stampFraction = maskCoverage(mask.stamp, mask.width, rect);
    if (stampFraction > STAMP_THRESHOLD) {
      return { text: '', confidence: 1, stamped: true, empty: false };
    }

    const cell = extractCell(mask, rect, kind === 'letter' ? {} : { targetGlyphHeight: 48 });
    if (!cell) return emptyCell();

    const raw = await recognizer.read(cell.canvas, kind);
    const normalized =
      kind === 'letter'
        ? normalizeLetter(raw.text)
        : kind === 'time'
          ? normalizeTime(raw.text)
          : normalizePlusMinus(raw.text);


    return {
      text: normalized.text,
      confidence: Math.max(0, raw.confidence - normalized.penalty),
      stamped: false,
      empty: normalized.text === '',
    };
  };

  const totalCells = ORC_ROWS * LETTER_COLUMNS + TIME_ROWS * 3;
  let done = 0;
  const tick = async () => {
    done++;
    if (done % 6 === 0) {
      report(options, 'reading-cells', done / totalCells, `Reading cells… ${done}/${totalCells}`);
      await yieldToBrowser();
    }
    throwIfAborted(signal);
  };

  report(options, 'reading-cells', 0, 'Reading cells…');

  const orc: CellResult[][] = [];
  for (let row = 0; row < ORC_ROWS; row++) {
    const cells: CellResult[] = [];
    for (let column = 0; column < LETTER_COLUMNS; column++) {
      cells.push(await readCell(grid.orc[row][column], 'letter'));
      await tick();
    }
    orc.push(cells);
  }

  const time: TimeRowResult[] = [];
  for (let row = 0; row < TIME_ROWS; row++) {
    const cells = grid.time[row];
    const ipt = await readCell(cells.ipt, 'time');
    await tick();
    const wpt = await readCell(cells.wpt, 'time');
    await tick();
    const plusMinus = await readCell(cells.plusMinus, 'plusMinus');
    await tick();
    time.push({ ipt, wpt, plusMinus });
  }

  // Header fields are hints only: the operator picks the stage and the EQ by
  // hand, and these are shown next to that choice as a cross-check.
  const readHeader = async (
    rect: Rect,
    kind: RecognizeKind,
    normalize: (raw: string) => { text: string; penalty: number }
  ): Promise<CellResult> => {
    const strip = extractStrip(warped, mask, rect);
    if (!strip) return emptyCell();
    const raw = await recognizer.read(strip, kind);
    const normalized = normalize(raw.text);
    return {
      text: normalized.text,
      confidence: Math.max(0, raw.confidence - normalized.penalty),
      stamped: false,
      empty: normalized.text === '',
    };
  };

  const controlekaartNo = await readHeader(grid.controlekaartNo, 'cardNumber', normalizeCardNumber);
  const eqNo = await readHeader(grid.eqNo, 'eqNumber', normalizeEqNumber);

  report(options, 'done', 1, 'Scan complete.');

  return { controlekaartNo, eqNo, orc, time, warped, grid, gridDetected: detected };
}
