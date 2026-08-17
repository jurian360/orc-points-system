import 'server-only';

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

  return { scoreKey, timeScoreKey, merkScoreKey };
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

export function parseTimePenalties(value: unknown) {
  return rows(value, MAX_TIME_ROWS).map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      rowNumber: num(r.rowNumber),
      ipt: str(r.ipt),
      wpt: str(r.wpt),
      plusMinus: str(r.plusMinus),
      strafp: num(r.strafp),
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
