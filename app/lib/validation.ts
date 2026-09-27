import 'server-only';

import mongoose from 'mongoose';

import {
  DEFAULT_TIME_CONFIG,
  formatClock,
  parseClock,
  TIME_ROWS,
  type StageTimeConfig,
} from './timeScoring';
import { isClassification, type ClassificationValue } from './participants';
import {
  isRole,
  isValidEmail,
  isValidUsername,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  normalizeUsername,
  type Role,
} from './roles';
import { RESET_TOKEN_HEX_LENGTH } from './passwordReset';

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

// One physical controlekaart holds this many ORC rows and this many merk
// rows. A stage whose crews run out of ORC rows mid-stage
// (`Stage.usesSecondCard`) doubles both — the second card carries its own
// merk section too, since merk is sightings recorded as the crew goes, the
// same as the ORC letters — while the 10-row time module never doubles: it
// is fixed controls the crew passes once, not rows that can run out. See
// "Second answer card" in CLAUDE.md.
export const ORC_ROWS_PER_CARD = 30;
export const MERK_ROWS_PER_CARD = 6;

export const MAX_ANSWER_ROWS = 60; // forms send 30, or 60 for a usesSecondCard stage
export const MAX_TIME_ROWS = 20; // forms send 10
export const MAX_MERK_ROWS = 20; // forms send 6, or 12 for a usesSecondCard stage
export const MAX_COLUMNS = 8; // forms send 4
// Answers an appeal added to an ORC row, on top of the row's own. The stage
// form offers two, which covers the appeals that occur in practice ("both DR
// and DRR are correct"); the cap keeps headroom over that.
export const MAX_ALTERNATIVE_ANSWERS = 4; // forms send up to 2
export const MAX_FIELD_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;
// The controlekaart the Android app renders: one physical card's worth of ORC
// and merk rows. A submission is bounded by the card, not by the generous
// caps above — and stays bounded to one card's shape even for a stage with
// usesSecondCard: the app has no way to scan or submit a second card yet
// (see "Second answer card" in CLAUDE.md), so rows past this always come
// from an official completing the sheet through the web form instead.
export const APP_ORC_ROWS = ORC_ROWS_PER_CARD;
export const APP_MERK_ROWS = MERK_ROWS_PER_CARD;
export const APP_CARD_ROWS = APP_ORC_ROWS + APP_MERK_ROWS;
// A rally is numbered 1..100, so an entry list cannot hold more crews than that.
export const MAX_IMPORT_PARTICIPANTS = 100;
// A time control hands in at most one time per participant, so the same bound
// holds for the import of one control's times.
export const MAX_IMPORT_TIMES = 100;
// Legs of a rally. Two or three in practice — a morning and an afternoon, or a
// day each — and the cap keeps headroom over that while keeping a caller from
// making the running order and the printed result sheet arbitrarily wide.
export const MAX_ROUTES = 20;

// Stages of a rally. A real event has a handful; every stage added re-scores
// the whole rally and widens the printed result sheet by four columns, so the
// cap is generous headroom that still keeps both bounded.
export const MAX_STAGES = 100;

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

// An id as it arrives in a request body or a path segment. Every route in the
// app inlines this check; new code goes through here so the guard has one home,
// and so an id can never reach a Mongoose filter unchecked.
export function parseObjectId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return mongoose.Types.ObjectId.isValid(value) ? value : null;
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

// --- Accounts --------------------------------------------------------------

// A username, normalised the way it is stored. The rules live in
// app/lib/roles.ts because the login and user forms check them too — a name the
// form accepts must not be refused here.
export function parseUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeUsername(value.slice(0, MAX_USERNAME_LENGTH + 1));
  return isValidUsername(normalized) ? normalized : null;
}

// A password as it is typed. Not trimmed — leading and trailing spaces are part
// of a password — and bounded, because scrypt over an unbounded string is a
// CPU-exhaustion vector.
export function parsePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) return null;
  return value;
}

export function parseRole(value: unknown): Role | null {
  return isRole(value) ? value : null;
}

// An email as typed into the forgot-password form: required, so an
// unparseable value is simply not a request the route can act on.
export function parseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeEmail(value.slice(0, MAX_EMAIL_LENGTH + 1));
  return isValidEmail(normalized) ? normalized : null;
}

// An account's email as sent from the user forms. Optional, unlike
// `parseEmail` above, so '' is a valid value — clearing the field — the same
// shape `parseOptionalName` gives driver and navigator names.
export function parseOptionalEmail(value: unknown): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const normalized = normalizeEmail(value.slice(0, MAX_EMAIL_LENGTH + 1));
  if (normalized === '') return '';
  return isValidEmail(normalized) ? normalized : null;
}

// The token a forgot-password link carries. Bounded and shaped before it ever
// reaches a query: `generateResetToken` only ever produces this exact hex
// shape, so anything else is not a token this app issued.
const RESET_TOKEN_PATTERN = new RegExp(`^[0-9a-f]{${RESET_TOKEN_HEX_LENGTH}}$`, 'i');

export function parseResetToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return RESET_TOKEN_PATTERN.test(value) ? value : null;
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

// The numeric settings of a stage's time config, so the boolean one below
// cannot be passed to the number parser by mistake.
type NumericTimeConfigKey = {
  [K in keyof StageTimeConfig]: StageTimeConfig[K] extends number ? K : never;
}[keyof StageTimeConfig];

export function parseTimeConfig(value: unknown): StageTimeConfig {
  const raw = (value ?? {}) as Record<string, unknown>;

  const clamp = (candidate: unknown, max: number, fallback: number): number => {
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return fallback;
    return Math.min(Math.max(Math.round(candidate), 0), max);
  };

  const field = (key: NumericTimeConfigKey, max: number): number =>
    clamp(raw[key], max, DEFAULT_TIME_CONFIG[key]);

  const outOfWindowPenalty = field('outOfWindowPenalty', MAX_PENALTY);

  return {
    breakMinutes: field('breakMinutes', MAX_MINUTES),
    gtcEarlyWindow: field('gtcEarlyWindow', MAX_MINUTES),
    gtcLateWindow: field('gtcLateWindow', MAX_MINUTES),
    finishEarlyWindow: field('finishEarlyWindow', MAX_MINUTES),
    finishLateWindow: field('finishLateWindow', MAX_MINUTES),
    outOfWindowPenalty,
    // A body that says nothing about the VTC keeps this stage on the GTC's
    // maximum — what it was scored with before the VTC had one of its own — and
    // not on the standard 60, which would re-score a stage keyed with other
    // limits. Same fallback as `resolveTimeConfig`.
    finishOutOfWindowPenalty: clamp(
      raw.finishOutOfWindowPenalty,
      MAX_PENALTY,
      outOfWindowPenalty
    ),
    finishOutOfWindowFlat: raw.finishOutOfWindowFlat === true,
  };
}

// Shared by POST /api/stages and PUT /api/stages/[id] — these were previously
// two identical copies that could drift apart.
//
// `orcCap`/`merkCap` are how many ORC/merk rows a stage is actually allowed
// to keep: `ORC_ROWS_PER_CARD`/`MERK_ROWS_PER_CARD` normally, doubled by the
// caller for a `usesSecondCard` stage. Defaulting to the generous
// `MAX_ANSWER_ROWS`/`MAX_MERK_ROWS` ceilings keeps every other caller (there
// are none yet, but the signature should not surprise one) working as before.
export function processScoreKey(
  body: Record<string, unknown>,
  orcCap: number = MAX_ANSWER_ROWS,
  merkCap: number = MAX_MERK_ROWS
): NormalizedScoreKey {
  const scoreKey = rows(body.scoreKey, orcCap).map((row) => {
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

  const merkScoreKey = rows(body.merkScoreKey, merkCap).map((row) => {
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
//
// `maxRows` is the caller-resolved cap: `ORC_ROWS_PER_CARD` for a normal
// stage, doubled for a `usesSecondCard` one. Defaults to the generous
// `MAX_ANSWER_ROWS` ceiling for a caller with no stage in hand yet.
export function parseAnswerRows(value: unknown, maxRows: number = MAX_ANSWER_ROWS) {
  return rows(value, maxRows).map((row) => {
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
//
// A time column has exactly TIME_ROWS rows, numbered 1..10 (start, the GTC's,
// finish). A row numbered outside that, or a second copy of a row, is not part
// of any card: it used to be stored as junk the re-score then ignored, and now
// it is dropped here, the first one of each number being the one kept.
export function parseTimePenalties(value: unknown) {
  const seen = new Set<number>();
  return rows(value, MAX_TIME_ROWS)
    .map((row) => {
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
    })
    .filter((row) => {
      const valid =
        Number.isInteger(row.rowNumber) &&
        row.rowNumber >= 1 &&
        row.rowNumber <= TIME_ROWS &&
        !seen.has(row.rowNumber);
      if (valid) seen.add(row.rowNumber);
      return valid;
    });
}

// Only the letter is taken from the client: the merk column is scored against
// the stage's merk key server-side (see app/lib/rescore.ts), so accepting a
// `strafp` here would let a sheet claim a total it did not earn — the same rule
// the time rows follow.
//
// `maxRows` is the caller-resolved cap: `MERK_ROWS_PER_CARD` for a normal
// stage, doubled for a `usesSecondCard` one. Defaults to the generous
// `MAX_MERK_ROWS` ceiling for a caller with no stage in hand yet.
export function parseMerkScores(value: unknown, maxRows: number = MAX_MERK_ROWS) {
  return rows(value, maxRows).map((row) => {
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
