// Shared ORC (letter answers) penalty scoring logic for answer sheets. The time
// (IPT / WPT) part of a sheet is scored in app/lib/timeScoring.ts; a sheet's
// stored `totalPenalty` is the sum of the two.
//
// A sheet is scored by comparing its selected letter answers against the
// stage's answer key (scoreKey). Each wrong, missing, or duplicated correct
// answer costs 30 penalty points, capped per row by the row's maxPenalty
// (when maxPenalty > 0). The same algorithm powers the scoring detail view and
// the server-side total stored on each answer sheet.

const PENALTY_PER_ERROR = 30;

export interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
  falseAnswers?: { column: number; value: string }[];
  maxPenalty?: number;
}

export interface AnswerRow {
  rowNumber: number;
  selectedAnswers: string[];
}

// Penalty points for a single row given its answer-key row and the
// participant's answers for that row.
export function calculateRowPenalty(
  scoreKeyRow: ScoreKeyRow,
  participantRow: AnswerRow | undefined
): number {
  if (!scoreKeyRow || !participantRow) return 0;

  let rowPenalty = 0;
  const selected = participantRow.selectedAnswers || [];

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

  return scoreKey.reduce((total, scoreKeyRow) => {
    const participantRow = (answers || []).find(
      (row) => row.rowNumber === scoreKeyRow.rowNumber
    );
    return total + calculateRowPenalty(scoreKeyRow, participantRow);
  }, 0);
}
