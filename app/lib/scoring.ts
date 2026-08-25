// Shared letter-answer penalty scoring for answer sheets: the ORC's rows first,
// the merk column at the bottom of this file. The time (IPT / WPT) part of a
// sheet is scored in app/lib/timeScoring.ts; a sheet's stored `totalPenalty` is
// the sum of the three.
//
// A sheet is scored by comparing its selected letter answers against the
// stage's answer key (scoreKey). Each wrong, missing, or doubled correct
// answer costs 30 penalty points, and so does the wrong order on a row whose
// key asks for one, capped per row by the row's maxPenalty (when
// maxPenalty > 0). Both the doubles and the letters the key rules out are
// counted per letter, exactly as in the merk column: every key letter written
// too often is its own 30 points, while writing the same surplus or ruled-out
// letter again is the same mistake, not a new one. The same algorithm powers
// the scoring detail view and the server-side total stored on each answer
// sheet.
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

  // 1. A letter the key rules out costs 30 points — but writing it again is the
  //    same error, not a new one: the key rules a letter out once, so a row of
  //    four D's on a key that says D is wrong costs 30, not 120. A key that
  //    rules the same letter out in more than one column asks for it that many
  //    times, and then it can be charged that many times (two false D's in the
  //    key: at most 60 on that row).
  const falseAllowance = new Map<string, number>();
  (scoreKeyRow.falseAnswers || []).forEach((falseAnswer) => {
    const letter = falseAnswer?.value;
    if (!letter) return;
    falseAllowance.set(letter, (falseAllowance.get(letter) || 0) + 1);
  });
  selected.forEach((answer) => {
    const remaining = answer ? falseAllowance.get(answer) || 0 : 0;
    if (remaining > 0) {
      falseAllowance.set(answer, remaining - 1);
      rowPenalty += PENALTY_PER_ERROR;
    }
  });

  // 2. A correct letter given more often than the key asks for costs 30 points,
  //    once per letter: a row of R D R D against the key R D pays 60 — one
  //    error for the extra R and one for the extra D — exactly as the merk
  //    column charges every doubled key letter. Repeating the same surplus
  //    letter again is the same mistake, so R R R against the key R D costs the
  //    30 of the doubled R once (plus the 30 for the missing D).
  const expectedCounts = new Map<string, number>();
  scoreKeyRow.answers.forEach((answer) => {
    if (!answer) return;
    expectedCounts.set(answer, (expectedCounts.get(answer) || 0) + 1);
  });
  const givenCounts = new Map<string, number>();
  selected.forEach((answer) => {
    if (!answer) return;
    givenCounts.set(answer, (givenCounts.get(answer) || 0) + 1);
  });
  expectedCounts.forEach((expected, letter) => {
    if ((givenCounts.get(letter) || 0) > expected) {
      rowPenalty += PENALTY_PER_ERROR;
    }
  });

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

// The penalty of every row a sheet holds, in the order the sheet holds them.
//
// A row's `strafp` is derived, exactly like the `strafp` of a time or a merk
// row: it is what the key says the row costs, never what an official typed. The
// entry form shows these numbers while a card is typed and the re-scoring
// (app/lib/rescore.ts) writes them to the stored sheet, so the row a card shows
// and the total the standings read are the same computation.
//
// Only the rows the sheet holds get a row here — a key row the sheet has no row
// for still costs its missing letters, but it costs them in the total
// (calculateTotalPenalty), not on a row of the card.
export function scoreAnswerRows(
  scoreKey: ScoreKeyRow[] | undefined,
  answers: AnswerRow[] | undefined
): { rowNumber: number; selectedAnswers: string[]; strafp: number }[] {
  const keyByRow = new Map((scoreKey || []).map((row) => [row.rowNumber, row]));

  return (answers || []).map((row) => {
    const keyRow = keyByRow.get(row.rowNumber);
    return {
      rowNumber: row.rowNumber,
      selectedAnswers: [...(row.selectedAnswers || [])],
      strafp: keyRow ? calculateRowPenalty(keyRow, row) : 0,
    };
  });
}

// --- Merk ------------------------------------------------------------------
//
// The merk column is the second lettered check of a stage, and unlike the ORC's
// it is scored *vertically*: one letter per row, 6 rows, and it is the column as
// a whole — not the row a letter happens to sit on — that is compared with the
// key. A key of "A, A, C" asks for two A's and a C somewhere in the column, in
// any rows and in any order.
//
// Exactly three things cost 30 points, and no letter can cost them more than
// once:
//
//   - a key letter given fewer times than the key asks for (a missing letter);
//   - a key letter given more times than the key asks for (a double);
//   - a letter the key explicitly rules out (a false merk), however often it is
//     written.
//
// The false letters are the merk counterpart of an ORC row's `falseAnswers`:
// officials type them next to the correct ones, and — because this check is
// vertical — they are read as one set over the whole column, not per row. A
// letter that is in neither list is ignored, however often it is written — the
// key decides what is scored here just as it does for the ORC rows. Against the
// key A, A, C with B ruled out as false:
//
//   A C         -> 30, one A is missing
//   A A C C     -> 30, C is doubled
//   B A A C     -> 30, B is ruled out by the key
//   B B A A C   -> 30, still one B — never twice for the same letter
//   D A A C     ->  0, D is part of neither list
//   A A A C     -> 30, A is doubled
//   A A A C A   -> 30, still one double of A — never twice for the same letter
//
// A sheet with no merk rows is an untyped column, not an unscored one: every
// letter of the key counts as missing, the same as the blank card it stands
// for. This is what keeps rescoreRally and a re-saved sheet in agreement.

export interface MerkKeyRow {
  rowNumber: number;
  merk?: string;
  // The letter this row rules out. Like the correct letters, the false ones are
  // read as a set over the whole column (see merkFalseLetters) — the row a
  // false letter is typed on is only where the official happened to write it.
  falseMerk?: string;
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
//   'false'   — a letter the key explicitly rules out
//   'ignored' — a letter the key does not use either way, which never costs
//               anything
//   'missing' — an empty row carrying the 30 points of a key letter the column
//               never got; the check is vertical, so the letter is charged to
//               the row of the key that asks for it (see below)
export type MerkRowStatus = 'blank' | 'ok' | 'double' | 'false' | 'ignored' | 'missing';

export interface ScoredMerkRow {
  rowNumber: number;
  merk: string;
  strafp: number;
  status: MerkRowStatus;
  // The key letter this row was charged for on a 'missing' row — the letter the
  // column is short of, not a letter the participant wrote.
  missingMerk?: string;
}

export interface MerkPenaltyResult {
  // The merk part of a sheet's penalty: 30 per missing key letter, per doubled
  // key letter and per false letter given, capped by the column's maximum when
  // the stage sets one.
  totalPenalty: number;
  rows: ScoredMerkRow[];
  // Key letters the column is short of, and key letters it holds too many of.
  // Each of them is one 30-point error; a missing letter is also shown on a row
  // of `rows` so the column adds up to what it costs.
  missing: string[];
  doubled: string[];
  // The false letters this column actually holds — one 30-point error each,
  // however often each of them was written.
  falseGiven: string[];
  // The distinct letters the key asks for and the distinct letters it rules
  // out, both sorted.
  keyLetters: string[];
  falseLetters: string[];
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

// The distinct letters a stage's merk key rules out, as one set over the whole
// column — the row a false letter was typed on carries no meaning, exactly as
// for the correct ones.
//
// A letter the key also asks for is not a false answer: the correct key wins, so
// a key that contradicts itself never charges a participant for writing what it
// asked for.
export function merkFalseLetters(merkScoreKey: MerkKeyRow[] | undefined): string[] {
  const correct = new Set(
    (merkScoreKey || []).map((row) => normalizeMerk(row?.merk)).filter(Boolean)
  );
  const falseLetters = new Set(
    (merkScoreKey || [])
      .map((row) => normalizeMerk(row?.falseMerk))
      .filter((letter) => letter && !correct.has(letter))
  );
  return Array.from(falseLetters).sort();
}

// The worst a participant can do on the merk column: every distinct letter of
// the key missing and every letter it rules out written, one error each,
// bounded by the column's cap. Used for the "max penalty" overviews on the
// stage form and the stage key card.
export function maxMerkPenalty(merkScoreKey: MerkKeyRow[] | undefined): number {
  const distinct = new Set(
    (merkScoreKey || []).map((row) => normalizeMerk(row?.merk)).filter(Boolean)
  );
  const worst =
    (distinct.size + merkFalseLetters(merkScoreKey).length) * PENALTY_PER_ERROR;
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
  const falseLetters = merkFalseLetters(merkScoreKey);
  const falseSet = new Set(falseLetters);

  // Rows are read in row order so that, when a letter is written too often, the
  // points land on the row that made it a double rather than on the first
  // legitimate one.
  const given = [...(merkScores || [])].sort(
    (a, b) => (a?.rowNumber || 0) - (b?.rowNumber || 0)
  );
  const givenCounts = countLetters(
    given.map((row) => normalizeMerk(row?.merk)).filter(Boolean)
  );

  // The rows the column is shown on: the ones the sheet holds plus the ones the
  // key asks about, so a key row a sheet never got is still a row of the column.
  const scoredByRow = new Map<number, ScoredMerkRow>();
  (merkScoreKey || []).forEach((row) => {
    const rowNumber = row?.rowNumber || 0;
    if (!rowNumber || scoredByRow.has(rowNumber)) return;
    scoredByRow.set(rowNumber, { rowNumber, merk: '', strafp: 0, status: 'blank' });
  });

  const seen = new Map<string, number>();
  const seenFalse = new Map<string, number>();
  given.forEach((row) => {
    const merk = normalizeMerk(row?.merk);
    const rowNumber = row?.rowNumber || 0;

    if (!merk) {
      scoredByRow.set(rowNumber, { rowNumber, merk: '', strafp: 0, status: 'blank' });
      return;
    }

    if (falseSet.has(merk)) {
      // A letter the key rules out. Like a double, it costs 30 points once: the
      // first row that holds it carries them, the repeats are the same error.
      const occurrence = (seenFalse.get(merk) || 0) + 1;
      seenFalse.set(merk, occurrence);
      scoredByRow.set(rowNumber, {
        rowNumber,
        merk,
        strafp: occurrence === 1 ? PENALTY_PER_ERROR : 0,
        status: 'false',
      });
      return;
    }

    const expected = keyCounts.get(merk);
    if (expected === undefined) {
      // In neither list — free, however often it is written.
      scoredByRow.set(rowNumber, { rowNumber, merk, strafp: 0, status: 'ignored' });
      return;
    }

    const occurrence = (seen.get(merk) || 0) + 1;
    seen.set(merk, occurrence);

    if (occurrence <= expected) {
      scoredByRow.set(rowNumber, { rowNumber, merk, strafp: 0, status: 'ok' });
      return;
    }

    // The first surplus occurrence carries the 30 points for the double; the
    // ones after it are the same error and cost nothing more.
    scoredByRow.set(rowNumber, {
      rowNumber,
      merk,
      strafp: occurrence === expected + 1 ? PENALTY_PER_ERROR : 0,
      status: 'double',
    });
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

  // One error per false letter the column holds, however often it was written.
  const falseGiven = falseLetters.filter((letter) => (givenCounts.get(letter) || 0) > 0);

  // A missing letter is an error of the column, not of a row — but a column
  // whose rows all read 0 while the total reads 30 is unreadable, so the points
  // are shown on an empty row: the row of the key that asks for the letter when
  // that row is still empty, otherwise the first empty row of the column. A
  // column with no empty row left keeps the points in the total only.
  const keyRowsByLetter = new Map<string, number[]>();
  (merkScoreKey || []).forEach((row) => {
    const letter = normalizeMerk(row?.merk);
    const rowNumber = row?.rowNumber || 0;
    if (!letter || !rowNumber) return;
    const rowNumbers = keyRowsByLetter.get(letter);
    if (rowNumbers) rowNumbers.push(rowNumber);
    else keyRowsByLetter.set(letter, [rowNumber]);
  });

  // The key row a missing letter belongs to: the first one the column did not
  // answer, so a letter the key asks for twice and got once points at the second.
  const keyRowOf = (letter: string): number | undefined => {
    const rowNumbers = keyRowsByLetter.get(letter);
    if (!rowNumbers || rowNumbers.length === 0) return undefined;
    const answered = givenCounts.get(letter) || 0;
    return rowNumbers[Math.min(answered, rowNumbers.length - 1)];
  };

  const emptyRows = Array.from(scoredByRow.values())
    .filter((row) => row.status === 'blank')
    .map((row) => row.rowNumber)
    .sort((a, b) => a - b);

  // Charged in the order of the key so the letters land on the card top down.
  [...missing]
    .sort((a, b) => (keyRowOf(a) || 0) - (keyRowOf(b) || 0))
    .forEach((letter) => {
      if (emptyRows.length === 0) return;
      const preferred = keyRowOf(letter);
      const index = preferred !== undefined ? emptyRows.indexOf(preferred) : -1;
      const [rowNumber] = emptyRows.splice(index >= 0 ? index : 0, 1);
      scoredByRow.set(rowNumber, {
        rowNumber,
        merk: '',
        strafp: PENALTY_PER_ERROR,
        status: 'missing',
        missingMerk: letter,
      });
    });

  const rows = Array.from(scoredByRow.values()).sort((a, b) => a.rowNumber - b.rowNumber);

  const raw =
    (missing.length + doubled.length + falseGiven.length) * PENALTY_PER_ERROR;
  const maxPenalty = merkColumnCap(merkScoreKey);
  const capped = maxPenalty > 0 && raw > maxPenalty;

  return {
    totalPenalty: capped ? maxPenalty : raw,
    rows,
    missing,
    doubled,
    falseGiven,
    keyLetters: Array.from(keyCounts.keys()).sort(),
    falseLetters,
    maxPenalty,
    capped,
  };
}
