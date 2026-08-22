// Shared letter-answer penalty scoring for answer sheets: the ORC's rows first,
// the merk column at the bottom of this file. The time (IPT / WPT) part of a
// sheet is scored in app/lib/timeScoring.ts; a sheet's stored `totalPenalty` is
// the sum of the three.
//
// A sheet is scored by comparing its selected letter answers against the
// stage's answer key (scoreKey). Each wrong, missing, or duplicated correct
// answer costs 30 penalty points, and so does the wrong order on a row whose
// key asks for one, capped per row by the row's maxPenalty (when
// maxPenalty > 0). The same algorithm powers the scoring detail view and the
// server-side total stored on each answer sheet.
//
// The *key* decides which rows are scored, never the sheet: a row the
// participant did not answer costs its missing letters whether the sheet holds
// a blank row for it or holds no row at all. A sheet written by the time import
// (app/api/stages/[id]/times/import) carries no answer rows at all until an
// official types the card, and it has to score the same as the blank card it
// stands for — otherwise re-scoring a rally and re-saving a sheet, which are
// the same computation, would disagree.

export const PENALTY_PER_ERROR = 30;

export interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
  falseAnswers?: { column: number; value: string }[];
  maxPenalty?: number;
  // The letters of this row have to be given in the order of the key ("volgorde").
  // Only ORC rows can ask for an order — the time and merk columns have none.
  orderMatters?: boolean;
}

export interface AnswerRow {
  rowNumber: number;
  selectedAnswers: string[];
}

// Did the participant give the correct letters of an ordered row out of order?
//
// Only the letters that are in the key say anything about the order, so false
// and unknown letters are ignored. The given letters are in order exactly when
// they are a *subsequence* of the key: for the key BAC, "BC" and "AC" are in
// order, "CA" and "AB" are not.
//
// Two things never cost an order penalty:
//   - a key of fewer than two letters — there is no order to keep;
//   - fewer than two correct letters given — a single letter cannot be out of
//     order, so a participant who wrote only "N" of the key "NW" pays for the
//     missing W and nothing more.
export function hasOrderError(
  scoreKeyRow: ScoreKeyRow,
  participantRow: AnswerRow | undefined
): boolean {
  if (!scoreKeyRow?.orderMatters) return false;

  const key = (scoreKeyRow.answers || []).filter(Boolean);
  if (key.length < 2) return false;

  const given = (participantRow?.selectedAnswers || []).filter(
    (answer) => answer && key.includes(answer)
  );
  if (given.length < 2) return false;

  // Greedy subsequence match: every given letter has to appear in the rest of
  // the key, after the letter before it.
  let keyIndex = 0;
  for (const letter of given) {
    while (keyIndex < key.length && key[keyIndex] !== letter) keyIndex++;
    if (keyIndex === key.length) return true;
    keyIndex++;
  }

  return false;
}

// Penalty points for a single row given its answer-key row and the
// participant's answers for that row.
//
// A missing `participantRow` is an unanswered row, not an unscored one: it is
// scored as a row with no letters, which costs the key's letters as missing.
// A key row with no letters of its own still costs nothing, so the rows a stage
// does not use stay free.
export function calculateRowPenalty(
  scoreKeyRow: ScoreKeyRow,
  participantRow: AnswerRow | undefined
): number {
  if (!scoreKeyRow) return 0;

  let rowPenalty = 0;
  const selected = participantRow?.selectedAnswers || [];

  // 1. Explicit false answers cost 30 points each.
  selected.forEach((answer) => {
    if (answer && scoreKeyRow.falseAnswers) {
      const isFalse = scoreKeyRow.falseAnswers.some((fa) => fa.value === answer);
      if (isFalse) {
        rowPenalty += PENALTY_PER_ERROR;
      }
    }
  });

  // 2. A correct answer given more times than expected costs 30 points.
  const correctGiven = selected.filter((answer) =>
    scoreKeyRow.answers.includes(answer)
  );
  if (correctGiven.length > scoreKeyRow.answers.length) {
    rowPenalty += PENALTY_PER_ERROR;
  }

  // 3. Each missing required correct answer costs 30 points.
  const requiredAnswers = [...scoreKeyRow.answers];
  selected.forEach((answer) => {
    const index = requiredAnswers.indexOf(answer);
    if (index >= 0) {
      requiredAnswers.splice(index, 1);
    }
  });
  rowPenalty += requiredAnswers.length * PENALTY_PER_ERROR;

  // 4. The wrong order on a row that asks for one costs 30 points, once,
  //    on top of whatever the letters themselves cost.
  if (hasOrderError(scoreKeyRow, participantRow)) {
    rowPenalty += PENALTY_PER_ERROR;
  }

  // Cap by the row's maximum penalty (only when a cap is set).
  if (
    scoreKeyRow.maxPenalty !== undefined &&
    scoreKeyRow.maxPenalty > 0 &&
    rowPenalty > scoreKeyRow.maxPenalty
  ) {
    rowPenalty = scoreKeyRow.maxPenalty;
  }

  return rowPenalty;
}

// Total penalty for a whole answer sheet against a stage's answer key.
export function calculateTotalPenalty(
  scoreKey: ScoreKeyRow[],
  answers: AnswerRow[]
): number {
  if (!scoreKey) return 0;

  // Every row of the key is scored, including the ones the sheet has no row
  // for — see calculateRowPenalty.
  return scoreKey.reduce((total, scoreKeyRow) => {
    const participantRow = (answers || []).find(
      (row) => row.rowNumber === scoreKeyRow.rowNumber
    );
    return total + calculateRowPenalty(scoreKeyRow, participantRow);
  }, 0);
}

// --- Merk ------------------------------------------------------------------
//
// The merk column is the second lettered check of a stage, and unlike the ORC's
// it is scored *vertically*: one letter per row, 6 rows, and it is the column as
// a whole — not the row a letter happens to sit on — that is compared with the
// key. A key of "A, A, C" asks for two A's and a C somewhere in the column, in
// any rows and in any order.
//
// Exactly two things cost 30 points, and no letter of the key can cost them
// more than once:
//
//   - a key letter given fewer times than the key asks for (a missing letter);
//   - a key letter given more times than the key asks for (a double).
//
// A letter that is not in the key at all is ignored, however often it is
// written — the key decides what is scored here just as it does for the ORC
// rows. Against the key A, A, C:
//
//   A C         -> 30, one A is missing
//   A A C C     -> 30, C is doubled
//   B A A C     ->  0, B is not part of this check
//   A A A C     -> 30, A is doubled
//   A A A C A   -> 30, still one double of A — never twice for the same letter
//
// A sheet with no merk rows is an untyped column, not an unscored one: every
// letter of the key counts as missing, the same as the blank card it stands
// for. This is what keeps rescoreRally and a re-saved sheet in agreement.

export interface MerkKeyRow {
  rowNumber: number;
  merk?: string;
  // The merk column has no per-row penalty — the check is vertical. The row
  // maximums are summed into one cap on the whole column (see merkColumnCap).
  maxPenalty?: number;
}

export interface MerkAnswerRow {
  rowNumber: number;
  merk?: string;
}

// What the column made of one row's letter.
//   'blank'   — nothing written on this row
//   'ok'      — a key letter, within the number of times the key asks for it
//   'double'  — a key letter written more often than the key asks for
//   'ignored' — a letter the key does not use, which never costs anything
export type MerkRowStatus = 'blank' | 'ok' | 'double' | 'ignored';

export interface ScoredMerkRow {
  rowNumber: number;
  merk: string;
  strafp: number;
  status: MerkRowStatus;
}

export interface MerkPenaltyResult {
  // The merk part of a sheet's penalty: 30 per missing and per doubled key
  // letter, capped by the column's maximum when the stage sets one.
  totalPenalty: number;
  rows: ScoredMerkRow[];
  // Key letters the column is short of, and key letters it holds too many of.
  // Each of them is one 30-point error.
  missing: string[];
  doubled: string[];
  // The distinct letters the key asks for, most-asked-for first as written.
  keyLetters: string[];
  // The cap that was applied (0 when the stage sets none) and whether it bit.
  maxPenalty: number;
  capped: boolean;
}

// Letters are compared case- and whitespace-insensitively, so a key typed as
// "a" grades a card typed as "A".
export function normalizeMerk(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function countLetters(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  values.forEach((letter) => counts.set(letter, (counts.get(letter) || 0) + 1));
  return counts;
}

// The most the merk column of a stage can cost. The key rows carry a maximum
// each — the merk check has no rows of its own to cap, so they are summed into
// one cap on the column. 0 (the default) means no cap, exactly as on an ORC row.
export function merkColumnCap(merkScoreKey: MerkKeyRow[] | undefined): number {
  return (merkScoreKey || []).reduce((sum, row) => sum + (row?.maxPenalty || 0), 0);
}

// The worst a participant can do on the merk column: every distinct letter of
// the key wrong once, bounded by the column's cap. Used for the "max penalty"
// overviews on the stage form and the stage key card.
export function maxMerkPenalty(merkScoreKey: MerkKeyRow[] | undefined): number {
  const distinct = new Set(
    (merkScoreKey || []).map((row) => normalizeMerk(row?.merk)).filter(Boolean)
  );
  const worst = distinct.size * PENALTY_PER_ERROR;
  const cap = merkColumnCap(merkScoreKey);
  return cap > 0 ? Math.min(worst, cap) : worst;
}

// Score the merk column of one sheet against the merk key of its stage.
export function calculateMerkPenalty(
  merkScoreKey: MerkKeyRow[] | undefined,
  merkScores: MerkAnswerRow[] | undefined
): MerkPenaltyResult {
  const keyLetterList = (merkScoreKey || [])
    .map((row) => normalizeMerk(row?.merk))
    .filter(Boolean);
  const keyCounts = countLetters(keyLetterList);

  // Rows are read in row order so that, when a letter is written too often, the
  // points land on the row that made it a double rather than on the first
  // legitimate one.
  const given = [...(merkScores || [])].sort(
    (a, b) => (a?.rowNumber || 0) - (b?.rowNumber || 0)
  );
  const givenCounts = countLetters(
    given.map((row) => normalizeMerk(row?.merk)).filter(Boolean)
  );

  const seen = new Map<string, number>();
  const rows: ScoredMerkRow[] = given.map((row) => {
    const merk = normalizeMerk(row?.merk);
    const rowNumber = row?.rowNumber || 0;

    if (!merk) return { rowNumber, merk: '', strafp: 0, status: 'blank' };

    const expected = keyCounts.get(merk);
    if (expected === undefined) {
      // Not a letter of this check — free, however often it is written.
      return { rowNumber, merk, strafp: 0, status: 'ignored' };
    }

    const occurrence = (seen.get(merk) || 0) + 1;
    seen.set(merk, occurrence);

    if (occurrence <= expected) return { rowNumber, merk, strafp: 0, status: 'ok' };

    // The first surplus occurrence carries the 30 points for the double; the
    // ones after it are the same error and cost nothing more.
    return {
      rowNumber,
      merk,
      strafp: occurrence === expected + 1 ? PENALTY_PER_ERROR : 0,
      status: 'double',
    };
  });

  const missing: string[] = [];
  const doubled: string[] = [];
  keyCounts.forEach((expected, letter) => {
    const count = givenCounts.get(letter) || 0;
    if (count < expected) missing.push(letter);
    else if (count > expected) doubled.push(letter);
  });
  missing.sort();
  doubled.sort();

  const raw = (missing.length + doubled.length) * PENALTY_PER_ERROR;
  const maxPenalty = merkColumnCap(merkScoreKey);
  const capped = maxPenalty > 0 && raw > maxPenalty;

  return {
    totalPenalty: capped ? maxPenalty : raw,
    rows,
    missing,
    doubled,
    keyLetters: Array.from(keyCounts.keys()).sort(),
    maxPenalty,
    capped,
  };
}
