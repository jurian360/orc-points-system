import React from 'react';
import { calculateRowPenalty } from '../lib/scoring';
import type { AnswerRow, ScoreKeyRow } from '../lib/scoring';

interface OrcAnswerGridProps {
  scoreKey: ScoreKeyRow[];
  answers: AnswerRow[];
}

// Renders a participant's ORC letter answers against a stage's answer key as
// the two ORC's columns of the physical SARK controlekaart (e.g. 1-15 / 16-30),
// so the view can be compared to the paper card directly.
//
// The two columns are emitted as bare grid items rather than wrapped in their
// own grid, so the caller decides the surrounding layout: the single-sheet
// scoring view puts them side by side, while the participant overview places
// them alongside the time and merk columns of the same card.
const OrcAnswerGrid: React.FC<OrcAnswerGridProps> = ({ scoreKey, answers }) => {
  const isAnswerCorrect = (row: ScoreKeyRow, colIndex: number, answer: string): boolean =>
    Boolean(answer) && row.answers[colIndex] === answer;

  const isAnswerFalse = (row: ScoreKeyRow, colIndex: number, answer: string): boolean =>
    Boolean(answer) && Boolean(row.falseAnswers?.some((fa) => fa.value === answer));

  const findParticipantAnswer = (rowNumber: number): AnswerRow | undefined =>
    (answers || []).find((answer) => answer.rowNumber === rowNumber);

  const sortedRows = [...(scoreKey || [])].sort((a, b) => a.rowNumber - b.rowNumber);
  const half = Math.ceil(sortedRows.length / 2);
  const leftRows = sortedRows.slice(0, half);
  const rightRows = sortedRows.slice(half);

  const columnRange = (rows: ScoreKeyRow[]): string =>
    rows.length > 0 ? `${rows[0].rowNumber}–${rows[rows.length - 1].rowNumber}` : '';

  const answerHeader = (
    <thead>
      <tr className="bg-purple-100">
        <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800 w-10">NR</th>
        <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">Col 1</th>
        <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">Col 2</th>
        <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">Col 3</th>
        <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">Col 4</th>
        <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">Strafp.</th>
      </tr>
    </thead>
  );

  const renderAnswerRow = (row: ScoreKeyRow) => {
    const participantRow = findParticipantAnswer(row.rowNumber);
    const rowPenalties = calculateRowPenalty(row, participantRow);

    return (
      <tr key={row.rowNumber} className={row.rowNumber % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
        <td className="py-1.5 px-2 border-2 border-gray-300 font-bold text-base text-gray-800 text-center">
          {row.rowNumber}
        </td>
        {[0, 1, 2, 3].map((colIndex) => {
          const answer = participantRow?.selectedAnswers[colIndex] || '';
          const isCorrect = isAnswerCorrect(row, colIndex, answer);
          const isFalse = isAnswerFalse(row, colIndex, answer);

          let cellClass = 'bg-gray-100 text-gray-400';
          let borderClass = 'border-gray-300';

          if (answer) {
            if (isCorrect) {
              cellClass = 'bg-green-100 text-green-800';
              borderClass = 'border-green-400';
            } else if (isFalse) {
              cellClass = 'bg-red-100 text-red-800';
              borderClass = 'border-red-400';
            } else {
              cellClass = 'bg-yellow-100 text-yellow-800';
              borderClass = 'border-yellow-400';
            }
          }

          return (
            <td key={colIndex} className="py-1.5 px-1 border-2 border-gray-300 text-center">
              {answer ? (
                <div
                  className={`w-10 h-10 mx-auto flex items-center justify-center rounded-lg shadow-sm border-2 ${cellClass} ${borderClass}`}
                >
                  <span className="text-xl font-bold">{answer}</span>
                </div>
              ) : (
                <div className="w-10 h-10 mx-auto flex items-center justify-center bg-gray-100 rounded-lg shadow-sm border-2 border-gray-300">
                  <span className="text-lg text-gray-400">-</span>
                </div>
              )}
            </td>
          );
        })}
        <td className="py-1.5 px-1 border-2 border-gray-300 text-center">
          {rowPenalties > 0 ? (
            <div className="px-2 py-1 bg-red-100 text-red-800 rounded-md shadow-sm border border-red-300 font-bold text-sm text-center">
              {rowPenalties}
            </div>
          ) : (
            <div className="px-2 py-1 bg-green-100 text-green-800 rounded-md shadow-sm border border-green-300 font-bold text-sm text-center">
              0
            </div>
          )}
        </td>
      </tr>
    );
  };

  if (sortedRows.length === 0) {
    return (
      <p className="text-base text-gray-600">This stage has no answer key rows to compare against.</p>
    );
  }

  return (
    <>
      {/* Column 1 — ORC's (first half of rows) */}
      <div>
        <h3 className="text-sm font-bold mb-1 text-gray-800">
          ORC&apos;s ({columnRange(leftRows)})
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            {answerHeader}
            <tbody>{leftRows.map((row) => renderAnswerRow(row))}</tbody>
          </table>
        </div>
      </div>

      {/* Column 2 — ORC's (second half of rows) */}
      {rightRows.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-1 text-gray-800">
            ORC&apos;s ({columnRange(rightRows)})
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              {answerHeader}
              <tbody>{rightRows.map((row) => renderAnswerRow(row))}</tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};

export default OrcAnswerGrid;
