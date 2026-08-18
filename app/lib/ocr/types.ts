// Shared types for the controlekaart scanner.
//
// Everything under app/lib/ocr runs in the BROWSER (see SCORECARD-OCR.md for
// why the pipeline is client-side). These modules must not import 'server-only'
// and must not touch node: builtins — they operate on ImageData and canvases.

export interface Point {
  x: number;
  y: number;
}

/** Four corners of the card, always ordered top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One recognised cell. `confidence` is 0..1; 0 for cells that were never OCR'd. */
export interface CellResult {
  text: string;
  confidence: number;
  /** Cell held only an orange/red stamp — deliberately returned as empty text. */
  stamped: boolean;
  /** No ink found, so OCR was skipped entirely. */
  empty: boolean;
}

export const emptyCell = (): CellResult => ({
  text: '',
  confidence: 0,
  stamped: false,
  empty: true,
});

/** 30 rows x 4 letter columns. */
export type OrcCells = CellResult[][];

export interface TimeRowResult {
  ipt: CellResult;
  wpt: CellResult;
  plusMinus: CellResult;
}

export interface ScanResult {
  /** Stage number printed after "CONTROLEKAART NO." — a hint, never applied automatically. */
  controlekaartNo: CellResult;
  /** Participant number printed after "EQ. NO." — a hint, never applied automatically. */
  eqNo: CellResult;
  orc: OrcCells;
  time: TimeRowResult[];
  /** Flattened, deskewed card, for the review preview. */
  warped: ImageData;
  /** Cell rectangles in `warped` coordinates, so the review step can draw the grid. */
  grid: ScanGrid;
  /** True when the table grid was located by line detection rather than by fallback proportions. */
  gridDetected: boolean;
}

export interface ScanGrid {
  orc: Rect[][];
  time: { ipt: Rect; wpt: Rect; plusMinus: Rect }[];
  controlekaartNo: Rect;
  eqNo: Rect;
}

export type ScanPhase =
  | 'preparing'
  | 'warping'
  | 'locating-grid'
  | 'loading-ocr'
  | 'reading-cells'
  | 'done';

export interface ScanProgress {
  phase: ScanPhase;
  /** 0..1 within the current phase. */
  ratio: number;
  message: string;
}

/**
 * The wire shape asked for in the feature request. Only non-empty entries are
 * included, so an untouched card serialises to two empty objects.
 */
export interface ScanPayload {
  controlekaartNo: string;
  eqNo: string;
  orcLetters: Record<string, string[]>;
  officialUse: Record<string, { ipt?: string; wpt?: string; plusMinus?: string }>;
}

export function toScanPayload(result: ScanResult): ScanPayload {
  const orcLetters: ScanPayload['orcLetters'] = {};
  result.orc.forEach((row, index) => {
    const letters = row.map((cell) => cell.text).filter((text) => text !== '');
    if (letters.length > 0) orcLetters[String(index + 1)] = letters;
  });

  const officialUse: ScanPayload['officialUse'] = {};
  result.time.forEach((row, index) => {
    const entry: { ipt?: string; wpt?: string; plusMinus?: string } = {};
    if (row.ipt.text) entry.ipt = row.ipt.text;
    if (row.wpt.text) entry.wpt = row.wpt.text;
    if (row.plusMinus.text) entry.plusMinus = row.plusMinus.text;
    if (Object.keys(entry).length > 0) officialUse[String(index + 1)] = entry;
  });

  return {
    controlekaartNo: result.controlekaartNo.text,
    eqNo: result.eqNo.text,
    orcLetters,
    officialUse,
  };
}
