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
export const MAX_FIELD_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;
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
    falseAnswers: { column: number; value: string }[];
    maxPenalty: number;
  }[];
  timeScoreKey: {
    rowNumber: number;
    ipt: string;
    wpt: string;
    plusMinus: string;
    maxPenalty: number;
  }[];
  merkScoreKey: { rowNumber: number; merk: string; maxPenalty: number }[];
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
      falseAnswers: rows(r.falseAnswers, MAX_COLUMNS).map((fa) => {
        const f = (fa ?? {}) as Record<string, unknown>;
        return { column: num(f.column), value: str(f.value) };
      }),
      maxPenalty: num(r.maxPenalty),
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
      maxPenalty: num(r.maxPenalty),
    };
  });

  return { scoreKey, timeScoreKey, merkScoreKey, timeConfig: parseTimeConfig(body.timeConfig) };
}

// --- Answer sheets ---------------------------------------------------------

export function parseAnswerRows(value: unknown) {
  return rows(value, MAX_ANSWER_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      selectedAnswers: rows(r.selectedAnswers, MAX_COLUMNS).map(str),
      strafp: num(r.strafp),
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
    };
  });
}

export function parseMerkScores(value: unknown) {
  return rows(value, MAX_MERK_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      merk: str(r.merk),
      strafp: num(r.strafp),
    };
  });
}
