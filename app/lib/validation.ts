import 'server-only';

import {
  DEFAULT_TIME_CONFIG,
  formatClock,
  parseClock,
  TIME_ROWS,
  type StageTimeConfig,
} from './timeScoring';
import { isClassification, type ClassificationValue } from './participants';

// Input validation and normalization for the API routes.
//
// Two jobs here:
//
//  1. Type safety against NoSQL operator injection. JSON permits objects, so an
//     unchecked `body.eq` can arrive as `{"$gt": 0}` and reach Mongoose as a
//     query operator rather than a value. Anything interpolated into a query
//     must be proven to be a scalar first.
//
//  2. Bounding. The forms submit fixed shapes (30 answer rows, 10 time rows,
//     6 merk rows, 4 letter columns), but nothing on the wire enforces that.
//     Unbounded arrays and strings are a memory- and storage-exhaustion vector.
//
// Caps carry headroom over what the current forms send so a UI change does not
// immediately start rejecting legitimate submissions.

export const MAX_ANSWER_ROWS = 60; // forms send 30
export const MAX_TIME_ROWS = 20; // forms send 10
export const MAX_MERK_ROWS = 20; // forms send 6
export const MAX_COLUMNS = 8; // forms send 4
// Answers an appeal added to an ORC row, on top of the row's own. The stage
// form offers two, which covers the appeals that occur in practice ("both DR
// and DRR are correct"); the cap keeps headroom over that.
export const MAX_ALTERNATIVE_ANSWERS = 4; // forms send up to 2
export const MAX_FIELD_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;
// The controlekaart the Android app renders: 30 ORC rows, then the 6 merk rows.
// A submission is bounded by the card, not by the generous caps above.
export const APP_ORC_ROWS = 30;
export const APP_MERK_ROWS = 6;
export const APP_CARD_ROWS = APP_ORC_ROWS + APP_MERK_ROWS;
// A rally is numbered 1..100, so an entry list cannot hold more crews than that.
export const MAX_IMPORT_PARTICIPANTS = 100;
// A time control hands in at most one time per participant, so the same bound
// holds for the import of one control's times.
export const MAX_IMPORT_TIMES = 100;

// Clamp any value to a bounded string. Objects and arrays collapse to a safe
// placeholder rather than being passed through.
function str(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_FIELD_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).slice(0, MAX_FIELD_LENGTH);
  }
  return '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function rows(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

// Participant number. Must be a scalar integer in the schema's 1..100 range —
// this is the guard that closes the operator-injection hole in the answer-sheet
// duplicate check.
export function parseEq(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > 100) return null;
  return value;
}

// Same, for the `?eq=` query-string form, where the value arrives as a string.
export function parseEqParam(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d{1,3}$/.test(value)) return null;
  return parseEq(Number(value));
}

export function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

// Class a participant rides in: one of the five class letters, or '' for a
// participant whose class has not been recorded. An unknown letter is rejected
// rather than blanked — a typo should not silently read as "no class".
export function parseClassification(value: unknown): ClassificationValue | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (trimmed === '') return '';
  return isClassification(trimmed) ? trimmed : null;
}

// Driver / navigator name. Optional, unlike `parseName`, so '' is a valid
// value; a non-string (the operator-injection shape) or an over-long name is
// not.
export function parseOptionalName(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > MAX_NAME_LENGTH ? null : trimmed;
}

// Row of the time column an import writes into: 1 (the start), 2-9 (the GTC's)
// or 10 (the finish). Anything else is not a row of the controlekaart.
export function parseTimeRowNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > TIME_ROWS) return null;
  return value;
}

// A passage time as it is stored on a sheet: "HH:MM". The shapes officials type
// ("8:05", "805", "8.05") are accepted and normalised here, so a sheet written
// by an import holds the same cell an official would have typed. A blank is
// rejected rather than treated as "clear this control" — an import only ever
// fills times in.
export function parseWpt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const minutes = parseClock(value.slice(0, MAX_FIELD_LENGTH));
  return minutes === null ? null : formatClock(minutes);
}

// --- Stage answer key ------------------------------------------------------

export interface NormalizedScoreKey {
  scoreKey: {
    rowNumber: number;
    answers: string[];
    alternativeAnswers: string[][];
    falseAnswers: { column: number; value: string }[];
    maxPenalty: number;
    orderMatters: boolean;
  }[];
  timeScoreKey: {
    rowNumber: number;
    ipt: string;
    wpt: string;
    plusMinus: string;
    maxPenalty: number;
  }[];
  merkScoreKey: {
    rowNumber: number;
    merk: string;
    falseMerk: string;
    maxPenalty: number;
  }[];
  timeConfig: StageTimeConfig;
}

// Stage time settings. Every field is a bounded, non-negative whole number of
// minutes (or penalty points); anything missing or unusable falls back to the
// standard rally limit rather than to zero, which would silently turn the
// windows off.
const MAX_MINUTES = 1440; // a day
const MAX_PENALTY = 100000;

export function parseTimeConfig(value: unknown): StageTimeConfig {
  const raw = (value ?? {}) as Record<string, unknown>;

  const field = (key: keyof StageTimeConfig, max: number): number => {
    const candidate = raw[key];
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      return DEFAULT_TIME_CONFIG[key];
    }
    return Math.min(Math.max(Math.round(candidate), 0), max);
  };

  return {
    breakMinutes: field('breakMinutes', MAX_MINUTES),
    gtcEarlyWindow: field('gtcEarlyWindow', MAX_MINUTES),
    gtcLateWindow: field('gtcLateWindow', MAX_MINUTES),
    finishEarlyWindow: field('finishEarlyWindow', MAX_MINUTES),
    finishLateWindow: field('finishLateWindow', MAX_MINUTES),
    outOfWindowPenalty: field('outOfWindowPenalty', MAX_PENALTY),
    missingFinishPenalty: field('missingFinishPenalty', MAX_PENALTY),
  };
}

// Shared by POST /api/stages and PUT /api/stages/[id] — these were previously
// two identical copies that could drift apart.
export function processScoreKey(body: Record<string, unknown>): NormalizedScoreKey {
  const scoreKey = rows(body.scoreKey, MAX_ANSWER_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      answers: rows(r.answers, MAX_COLUMNS).map(str),
      // The answers an appeal added: a bounded list of bounded rows of letters,
      // each one a complete answer for this row. Blank ones are dropped here so
      // a key never stores an empty variant, which would make every card on the
      // row free (see answerVariants in app/lib/scoring.ts).
      alternativeAnswers: rows(r.alternativeAnswers, MAX_ALTERNATIVE_ANSWERS)
        .map((variant) => rows(variant, MAX_COLUMNS).map(str).filter(Boolean))
        .filter((variant) => variant.length > 0),
      falseAnswers: rows(r.falseAnswers, MAX_COLUMNS).map((fa) => {
        const f = (fa ?? {}) as Record<string, unknown>;
        return { column: num(f.column), value: str(f.value) };
      }),
      maxPenalty: num(r.maxPenalty),
      // Only the ORC rows carry an order; anything but `true` is "no order",
      // never an object that could reach a query.
      orderMatters: r.orderMatters === true,
    };
  });

  const timeScoreKey = rows(body.timeScoreKey, MAX_TIME_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      ipt: str(r.ipt),
      wpt: str(r.wpt),
      plusMinus: str(r.plusMinus),
      maxPenalty: num(r.maxPenalty),
    };
  });

  const merkScoreKey = rows(body.merkScoreKey, MAX_MERK_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      merk: str(r.merk),
      // The letter this row rules out; read as part of the column-wide false
      // set, exactly like `merk` is read as part of the correct one.
      falseMerk: str(r.falseMerk),
      maxPenalty: num(r.maxPenalty),
    };
  });

  return { scoreKey, timeScoreKey, merkScoreKey, timeConfig: parseTimeConfig(body.timeConfig) };
}

// --- Answer sheets ---------------------------------------------------------

// Only the letters are taken from the client: what a row costs is scored
// against the stage's answer key server-side (see app/lib/rescore.ts), so
// accepting a `strafp` here would let a sheet claim a total it did not earn —
// the same rule the time and merk rows follow.
export function parseAnswerRows(value: unknown) {
  return rows(value, MAX_ANSWER_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      selectedAnswers: rows(r.selectedAnswers, MAX_COLUMNS).map(str),
      strafp: 0,
    };
  });
}

// Only the WPT is taken from the client: the ideal time, the +/- and the
// penalty of a time row are derived from the stage's time key server-side (see
// app/lib/rescore.ts), so accepting them here would let a sheet claim a total it
// did not earn.
export function parseTimePenalties(value: unknown) {
  return rows(value, MAX_TIME_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      ipt: '',
      wpt: str(r.wpt),
      plusMinus: '',
      strafp: 0,
      outOfWindow: false,
      missing: false,
    };
  });
}

// Only the letter is taken from the client: the merk column is scored against
// the stage's merk key server-side (see app/lib/rescore.ts), so accepting a
// `strafp` here would let a sheet claim a total it did not earn — the same rule
// the time rows follow.
export function parseMerkScores(value: unknown) {
  return rows(value, MAX_MERK_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      merk: str(r.merk),
      strafp: 0,
    };
  });
}

// --- Cards handed in by the Android app ------------------------------------

export interface ParsedCardRows {
  answers: { rowNumber: number; selectedAnswers: string[]; strafp: number }[];
  // Only present when the app sent the merk rows: a card that carries no merk
  // column must not blank the letters an official already typed.
  merkScores: { rowNumber: number; merk: string; strafp: number }[] | null;
}

// One letter of a card cell. The app sends a single upper-case character per
// column, or an empty string for a cell the participant left blank.
function cardLetter(value: unknown): string {
  if (typeof value !== 'string') return '';
  const letter = value.trim().toUpperCase();
  return /^[A-Z0-9]$/.test(letter) ? letter : '';
}

// The rows of a finalised card, as `{id, col1..col4}` objects.
//
// Rows 1-30 are the ORC rows; rows 31-36, if the app sends them, are the merk
// column, whose single letter is the row's first column. A row the app does not
// send is a row the participant left blank — the key decides what is scored,
// not the sheet (see app/lib/scoring.ts) — so the ORC rows are built for the
// whole card rather than only for what arrived.
//
// Returns null for anything that is not an array of row objects: a malformed
// card is refused, never silently stored as an empty one.
export function parseAppCardRows(value: unknown): ParsedCardRows | null {
  if (!Array.isArray(value)) return null;

  const orc = new Map<number, string[]>();
  const merk = new Map<number, string>();
  let sawMerkRow = false;

  for (const entry of value.slice(0, APP_CARD_ROWS)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;

    const id = typeof row.id === 'number' ? row.id : Number(row.id);
    if (!Number.isInteger(id) || id < 1 || id > APP_CARD_ROWS) return null;

    const letters = [row.col1, row.col2, row.col3, row.col4].map(cardLetter);

    if (id <= APP_ORC_ROWS) {
      orc.set(id, letters.filter((letter) => letter !== ''));
    } else {
      sawMerkRow = true;
      // The merk column holds one letter per row; the app only ever fills the
      // first column of those rows.
      merk.set(id - APP_ORC_ROWS, letters[0]);
    }
  }

  const answers = Array.from({ length: APP_ORC_ROWS }, (_, index) => ({
    rowNumber: index + 1,
    selectedAnswers: orc.get(index + 1) || [],
    strafp: 0,
  }));

  const merkScores = sawMerkRow
    ? Array.from({ length: APP_MERK_ROWS }, (_, index) => ({
        rowNumber: index + 1,
        merk: merk.get(index + 1) || '',
        strafp: 0,
      }))
    : null;

  return { answers, merkScores };
}
