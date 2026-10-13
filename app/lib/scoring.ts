// Shared letter-answer penalty scoring for answer sheets: the ORC's rows first,
// the merk column at the bottom of this file. The time (IPT / WPT) part of a
// sheet is scored in app/lib/timeScoring.ts; a sheet's stored `totalPenalty` is
// the sum of the three.
//
// A sheet is scored by comparing its selected letter answers against the
// stage's answer key (scoreKey). Each wrong, missing, or doubled correct
// answer costs 30 penalty points, and so does the wrong order on a row whose
// key asks for one, capped per row by the row's maxPenalty (when
// maxPenalty > 0). A row can hold more than one accepted answer — see
// `alternativeAnswers` below — and is then scored against the one that costs
// the participant the least. Both the doubles and the letters the key rules
// out are counted per letter, exactly as in the merk column: every key letter written
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
  // Further answers that are equally correct, each one a complete answer for
  // this row. This is where an appeal is recorded: when the jury rules that
  // both "D R" and "D R R" are right, the second one is kept here and the row
  // is scored against whichever of the two costs the participant the least, so
  // either answer is free and everything else is measured against the nearest
  // of them. Absent or empty is the single-answer key every stage held before
  // appeals could be written down.
  alternativeAnswers?: string[][];
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

// Every complete answer a row accepts: the key itself first, then the answers
// an appeal added. Variants with no letters are dropped — the stage form sends
// an empty one for an alternative nobody filled in — and a row that keeps no
// letters at all is left with a single empty variant, which is the free row of
// an ORC question the stage does not use.
export function answerVariants(scoreKeyRow: ScoreKeyRow | undefined): string[][] {
  const variants = [scoreKeyRow?.answers || [], ...(scoreKeyRow?.alternativeAnswers || [])]
    .map((variant) => (variant || []).filter(Boolean))
    .filter((variant) => variant.length > 0);

  return variants.length > 0 ? variants : [[]];
}

// Did the participant give the correct letters of an ordered row out of order,
// measured against one accepted answer?
//
// Only the letters that are in the key say anything about the order, so false
// and unknown letters are ignored. The row is in order when the key's letters
// can be read, in the key's order, out of what was written — the key being
// trimmed to the letters the participant gave, each at most as often as they
// gave it. For the key BAC, "BC" and "AC" are in order, "CA" and "AB" are not.
//
// It is the key that has to fit into the card, not the card into the key: a
// surplus letter is already charged as a double (rule 2), and must not cost the
// order as well. So on the key UZ, "UUZ", "UZUZ" and "ZUZU" are in order (the
// U-then-Z is there to read), while "ZU" and "ZZUU" are not.
//
// Two things never cost an order penalty:
//   - a key of fewer than two letters — there is no order to keep;
//   - one correct letter given, however often — a single letter cannot be out
//     of order, so a participant who wrote only "N" of the key "NW" pays for
//     the missing W and nothing more, and "UU" on the key UZ pays for the
//     missing Z and the doubled U, not for an order.
function variantOrderError(key: string[], selected: string[]): boolean {
  if (key.length < 2) return false;

  const given = selected.filter((answer) => answer && key.includes(answer));

  // The key's letters that were given, in the key's order: each letter as
  // often as the key asks for it, but no more often than it was written.
  const available = new Map<string, number>();
  given.forEach((letter) => available.set(letter, (available.get(letter) || 0) + 1));
  const expected = key.filter((letter) => {
    const remaining = available.get(letter) || 0;
    if (remaining === 0) return false;
    available.set(letter, remaining - 1);
    return true;
  });
  if (new Set(expected).size < 2) return false;

  // Greedy subsequence match: every expected letter has to appear in the rest
  // of what was written, after the letter before it.
  let givenIndex = 0;
  for (const letter of expected) {
    while (givenIndex < given.length && given[givenIndex] !== letter) givenIndex++;
    if (givenIndex === given.length) return true;
    givenIndex++;
  }

  return false;
}

// What one accepted answer costs, before the row's cap. `calculateRowPenalty`
// runs this over every variant of the row and charges the lowest.
function variantPenalty(
  scoreKeyRow: ScoreKeyRow,
  key: string[],
  selected: string[]
): number {
  let rowPenalty = 0;

  // 1. A letter the key rules out costs 30 points — but writing it again is the
  //    same error, not a new one: the key rules a letter out once, so a row of
  //    four D's on a key that says D is wrong costs 30, not 120. A key that
  //    rules the same letter out in more than one column asks for it that many
  //    times, and then it can be charged that many times (two false D's in the
  //    key: at most 60 on that row). The false letters belong to the row, not
  //    to one of its accepted answers, so they cost the same against every
  //    variant and never decide which variant is the cheapest.
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
  key.forEach((answer) => {
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
  const requiredAnswers = [...key];
  selected.forEach((answer) => {
    const index = requiredAnswers.indexOf(answer);
    if (index >= 0) {
      requiredAnswers.splice(index, 1);
    }
  });
  rowPenalty += requiredAnswers.length * PENALTY_PER_ERROR;

  // 4. The wrong order on a row that asks for one costs 30 points, once,
  //    on top of whatever the letters themselves cost.
  if (scoreKeyRow.orderMatters && variantOrderError(key, selected)) {
    rowPenalty += PENALTY_PER_ERROR;
  }

  return rowPenalty;
}

// How many of a variant's letters the participant wrote in the column the
// variant holds them in. Only a tie-break for which answer a row is shown
// against; it never changes what the row costs.
function positionalMatches(key: string[], selected: string[]): number {
  return key.reduce(
    (count, letter, index) => (letter && selected[index] === letter ? count + 1 : count),
    0
  );
}

// The accepted answer a row is scored against: the variant that costs the
// participant the least.
//
// Ties go first to the variant that matches most of the letters where the
// participant wrote them — so a card reading D R R against the key D R with
// D R R accepted is coloured against D R R, the answer the crew was going for
// — and then to the earlier variant, which is the key itself before the
// answers an appeal added. Both tie-breaks are display only: tied variants cost
// the same by definition.
export function matchedAnswerVariant(
  scoreKeyRow: ScoreKeyRow | undefined,
  participantRow: AnswerRow | undefined
): string[] {
  if (!scoreKeyRow) return [];

  const selected = participantRow?.selectedAnswers || [];
  const variants = answerVariants(scoreKeyRow);

  let best = variants[0];
  let bestPenalty = variantPenalty(scoreKeyRow, best, selected);
  let bestMatches = positionalMatches(best, selected);

  variants.slice(1).forEach((variant) => {
    const penalty = variantPenalty(scoreKeyRow, variant, selected);
    const matches = positionalMatches(variant, selected);
    if (penalty < bestPenalty || (penalty === bestPenalty && matches > bestMatches)) {
      best = variant;
      bestPenalty = penalty;
      bestMatches = matches;
    }
  });

  return best;
}

// Did the participant give the correct letters of an ordered row out of order?
// Measured against the answer the row is scored against, so a row with more
// than one accepted answer is only marked when the cheapest of them is out of
// order.
export function hasOrderError(
  scoreKeyRow: ScoreKeyRow,
  participantRow: AnswerRow | undefined
): boolean {
  if (!scoreKeyRow?.orderMatters) return false;

  return variantOrderError(
    matchedAnswerVariant(scoreKeyRow, participantRow),
    participantRow?.selectedAnswers || []
  );
}

// Penalty points for a single row given its answer-key row and the
// participant's answers for that row.
//
// A missing `participantRow` is an unanswered row, not an unscored one: it is
// scored as a row with no letters, which costs the key's letters as missing.
// A key row with no letters of its own still costs nothing, so the rows a stage
// does not use stay free.
//
// A row that accepts more than one answer costs the least of them: every
// variant is scored in full and the cheapest one is what the participant pays,
// which is what makes both answers of an appeal free and measures a wrong card
// against whichever of them it came closest to.
export function calculateRowPenalty(
  scoreKeyRow: ScoreKeyRow,
  participantRow: AnswerRow | undefined
): number {
  if (!scoreKeyRow) return 0;

  const selected = participantRow?.selectedAnswers || [];
  let rowPenalty = Math.min(
    ...answerVariants(scoreKeyRow).map((variant) =>
      variantPenalty(scoreKeyRow, variant, selected)
    )
  );

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
// The merk column is the second lettered check of a stage: one letter per row,
// 5 rows a card (row 6 is the Diversen count, below). It is scored row by row,
// each row against the merk key row with the same number — exactly as a
// one-letter ORC row is scored. A key row holds the correct letter (`merk`), a
// letter it rules out (`falseMerk`) and a cap (`maxPenalty`), and the row is
// handed to calculateRowPenalty as an ORC row with those, so the merk column
// and the ORC's cannot read the same mistake differently:
//
//   - the key's letter missing from its row (left empty, or another letter
//     written instead)                                           -> 30
//   - the letter the row rules out written                       -> 30
//   - both at once (the ruled-out letter instead of the key's)   -> 60
//   - the row's total capped at its maxPenalty when that is > 0
//
// Against the key G, -, G on rows 1-3:
//
//   -  G  -    -> 60, row 1 and row 3 are each missing their G
//   G  -  G    ->  0
//   H  -  G    -> 30, row 1 is missing its G
//   G  G  G    ->  0, row 2 asks for nothing, so its G costs nothing
//
// A key row with no letters of its own costs nothing, whatever is written on
// it, so the rows a stage does not use stay free. A letter in both lists of
// one row is a key that contradicts itself: the correct letter wins, so a
// participant is never charged for writing what the key asked for.
//
// A sheet with no merk rows is an untyped column, not an unscored one: every
// key row costs its missing letter, the same as the blank card it stands for.
// This is what keeps rescoreRally and a re-saved sheet in agreement.
//
// Row 6 is not a letter row (see Diversen below): it is left out of the key
// and of the sheet before anything here reads them, so a letter a key or a
// card still holds there from before is never scored.

export interface MerkKeyRow {
  rowNumber: number;
  merk?: string;
  // The letter this row rules out, the merk counterpart of an ORC row's
  // falseAnswers. It counts on its own row only.
  falseMerk?: string;
  // The most this row can cost; 0 (the default) means no cap, exactly as on an
  // ORC row.
  maxPenalty?: number;
}

export interface MerkAnswerRow {
  rowNumber: number;
  merk?: string;
}

// What a row's letter was, measured against its own key row.
//   'blank'   — nothing written, and the key row asks for nothing
//   'ok'      — the key row's letter
//   'missing' — nothing written where the key row asks for a letter
//   'wrong'   — another letter than the one the key row asks for
//   'false'   — the letter the key row rules out
//   'ignored' — a letter on a row whose key neither asks for nor rules out,
//               which never costs anything
export type MerkRowStatus = 'blank' | 'ok' | 'missing' | 'wrong' | 'false' | 'ignored';

export interface ScoredMerkRow {
  rowNumber: number;
  merk: string;
  strafp: number;
  status: MerkRowStatus;
  // The letter the key row asks for, when it asks for one — what a 'missing'
  // or 'wrong' row should have read.
  expectedMerk?: string;
  // The row cost more than its maxPenalty and was charged the cap.
  capped?: boolean;
}

export interface MerkPenaltyResult {
  // The merk part of a sheet's penalty — the Diversen line: the letters
  // (`letterPenalty`) plus the Diversen fine (`diversenPenalty`).
  totalPenalty: number;
  // The sum of the letter rows' strafp, each already capped by its own row.
  letterPenalty: number;
  // The count written on the Diversen row, and the 30 points per count it
  // costs. Never capped.
  diversenCount: number;
  diversenPenalty: number;
  // One row per letter row of the sheet and per letter row of the key, so a
  // key row a sheet never got is still a row of the column.
  rows: ScoredMerkRow[];
}

// --- Diversen ----------------------------------------------------------------
//
// Row 6 of the merk column is where an official writes how many times a crew
// is fined 30 points for something the letters do not cover. It holds a count,
// not a letter: 1 costs 30, 2 costs 60, 4 costs 120. The count is stored on
// the sheet (`diversenCount`), not in a merk row, and its points are added to
// the merk part of the sheet — the Diversen line of TOTAAL STRAFPUNTEN — on top
// of the letter rows: a row's cap is on its letter, and a fine is always
// charged in full. A stage with a second card still has one Diversen row, row 6; merk
// rows 7-12 are letters.
export const DIVERSEN_ROW = 6;
// Far past any real fine; it bounds what a typo can do to the standings.
export const MAX_DIVERSEN_COUNT = 99;

// Whether a merk row holds a letter — every row but the Diversen row.
export function isMerkLetterRow(rowNumber: unknown): boolean {
  return rowNumber !== DIVERSEN_ROW;
}

function merkLetterRows<T extends { rowNumber?: number }>(rows: T[] | undefined): T[] {
  return (rows || []).filter((row) => isMerkLetterRow(row?.rowNumber));
}

// A whole number 0..MAX_DIVERSEN_COUNT. Anything else — a blank cell, a
// fraction, a negative — counts as no fine; the API refuses those outright
// (parseDiversenCount), this only keeps a render path from throwing on them.
export function normalizeDiversenCount(value: unknown): number {
  const count =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : 0;
  if (!Number.isInteger(count) || count <= 0) return 0;
  return Math.min(count, MAX_DIVERSEN_COUNT);
}

export function diversenPenalty(count: unknown): number {
  return normalizeDiversenCount(count) * PENALTY_PER_ERROR;
}

// Letters are compared case- and whitespace-insensitively, so a key typed as
// "a" grades a card typed as "A".
export function normalizeMerk(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

// One merk key row as the one-letter ORC row it is scored as. A ruled-out
// letter that is also the correct one is dropped: the correct letter wins.
function merkKeyAsOrcRow(keyRow: MerkKeyRow | undefined, rowNumber: number): ScoreKeyRow {
  const merk = normalizeMerk(keyRow?.merk);
  const falseMerk = normalizeMerk(keyRow?.falseMerk);
  return {
    rowNumber,
    answers: merk ? [merk] : [],
    falseAnswers: falseMerk && falseMerk !== merk ? [{ column: 1, value: falseMerk }] : [],
    maxPenalty: keyRow?.maxPenalty || 0,
  };
}

// Score one merk row against its own key row.
export function scoreMerkRow(
  keyRow: MerkKeyRow | undefined,
  rowNumber: number,
  value: unknown
): ScoredMerkRow {
  const orcRow = merkKeyAsOrcRow(keyRow, rowNumber);
  const expected = orcRow.answers[0] || '';
  const ruledOut = orcRow.falseAnswers?.[0]?.value || '';
  const merk = normalizeMerk(value);
  const given = { rowNumber, selectedAnswers: merk ? [merk] : [] };

  let status: MerkRowStatus;
  if (!merk) status = expected ? 'missing' : 'blank';
  else if (merk === expected) status = 'ok';
  else if (merk === ruledOut) status = 'false';
  else if (expected) status = 'wrong';
  else status = 'ignored';

  const strafp = calculateRowPenalty(orcRow, given);
  const uncapped = calculateRowPenalty({ ...orcRow, maxPenalty: 0 }, given);

  return {
    rowNumber,
    merk,
    strafp,
    status,
    ...(expected ? { expectedMerk: expected } : {}),
    ...(uncapped > strafp ? { capped: true } : {}),
  };
}

// The most a merk key row can cost: its own letter missing and its ruled-out
// letter written, capped by the row's maximum.
function maxMerkRowPenalty(keyRow: MerkKeyRow): number {
  const orcRow = merkKeyAsOrcRow(keyRow, keyRow?.rowNumber || 0);
  const worst =
    (orcRow.answers.length + (orcRow.falseAnswers?.length || 0)) * PENALTY_PER_ERROR;
  const cap = orcRow.maxPenalty || 0;
  return cap > 0 ? Math.min(worst, cap) : worst;
}

// The worst a participant can do on the merk column: every row at its own
// worst. Used for the "max penalty" overviews on the stage form and the stage
// key card. The Diversen fine has no maximum, so it is not part of this.
export function maxMerkPenalty(keyRows: MerkKeyRow[] | undefined): number {
  return merkLetterRows(keyRows).reduce((sum, row) => sum + maxMerkRowPenalty(row), 0);
}

// Score the merk column of one sheet against the merk key of its stage, plus
// the sheet's Diversen count. `rows` holds the letter rows only — the Diversen
// row is a number, and each view renders it from `diversenCount`.
export function calculateMerkPenalty(
  keyRows: MerkKeyRow[] | undefined,
  sheetRows: MerkAnswerRow[] | undefined,
  diversenCountValue: unknown = 0
): MerkPenaltyResult {
  const keyByRow = new Map<number, MerkKeyRow>();
  merkLetterRows(keyRows).forEach((row) => {
    const rowNumber = row?.rowNumber || 0;
    if (rowNumber && !keyByRow.has(rowNumber)) keyByRow.set(rowNumber, row);
  });

  const givenByRow = new Map<number, string>();
  merkLetterRows(sheetRows).forEach((row) => {
    const rowNumber = row?.rowNumber || 0;
    if (rowNumber) givenByRow.set(rowNumber, normalizeMerk(row?.merk));
  });

  // The rows the column is shown on: the ones the sheet holds plus the ones the
  // key asks about, so a key row a sheet never got is still a row of the column.
  const rowNumbers = Array.from(new Set([...keyByRow.keys(), ...givenByRow.keys()])).sort(
    (a, b) => a - b
  );
  const rows = rowNumbers.map((rowNumber) =>
    scoreMerkRow(keyByRow.get(rowNumber), rowNumber, givenByRow.get(rowNumber))
  );

  const letterPenalty = rows.reduce((sum, row) => sum + row.strafp, 0);
  const diversenCount = normalizeDiversenCount(diversenCountValue);
  const fine = diversenCount * PENALTY_PER_ERROR;

  return {
    totalPenalty: letterPenalty + fine,
    letterPenalty,
    diversenCount,
    diversenPenalty: fine,
    rows,
  };
}
