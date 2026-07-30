import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { calculateRowPenalty, calculateTotalPenalty } from '../lib/scoring';

interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
  falseAnswers?: { column: number; value: string }[];
  maxPenalty?: number;
}

interface AnswerRow {
  rowNumber: number;
  selectedAnswers: string[];
}

interface Stage {
  _id: string;
  name: string;
  rallyId: string;
  scoreKey: ScoreKeyRow[];
}

interface AnswerSheet {
  _id: string;
  eq: number;
  rallyId: string;
  stageId: string;
  answers: AnswerRow[];
  totalPenalty: number;
  submittedAt: string;
}

interface AnswerSheetScoringViewProps {
  rallyId: string;
  sheetId: string;
}

const AnswerSheetScoringView: React.FC<AnswerSheetScoringViewProps> = ({ rallyId, sheetId }) => {
  const [stage, setStage] = useState<Stage | null>(null);
  const [sheet, setSheet] = useState<AnswerSheet | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sheetId) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        const sheetRes = await fetch(`/api/answersheets/${sheetId}`);
        if (!sheetRes.ok) throw new Error('Failed to fetch answer sheet');
        const sheetData: AnswerSheet = await sheetRes.json();
        setSheet(sheetData);

        const stageRes = await fetch(`/api/stages/${sheetData.stageId}`);
        if (!stageRes.ok) throw new Error('Failed to fetch stage');
        const stageData: Stage = await stageRes.json();
        setStage(stageData);
      } catch (err) {
        setError('Failed to load answer sheet scoring.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sheetId]);

  const isAnswerCorrect = (rowNumber: number, colIndex: number, answer: string): boolean => {
    if (!answer || !stage) return false;
    const scoreKeyRow = stage.scoreKey.find((row) => row.rowNumber === rowNumber);
    if (!scoreKeyRow) return false;
    return scoreKeyRow.answers[colIndex] === answer;
  };

  const isAnswerFalse = (rowNumber: number, colIndex: number, answer: string): boolean => {
    if (!answer || !stage) return false;
    const scoreKeyRow = stage.scoreKey.find((row) => row.rowNumber === rowNumber);
    if (!scoreKeyRow || !scoreKeyRow.falseAnswers) return false;
    return scoreKeyRow.falseAnswers.some((fa) => fa.value === answer);
  };

  const findParticipantAnswer = (rowNumber: number): AnswerRow | undefined => {
    if (!sheet) return undefined;
    return sheet.answers.find((answer) => answer.rowNumber === rowNumber);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        <p className="ml-4 text-lg font-medium">Loading...</p>
      </div>
    );
  }

  if (error || !stage || !sheet) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-md">
          <p>{error || 'No data available for this answer sheet.'}</p>
        </div>
        <div className="mt-6">
          <Link
            href={`/rallies/${rallyId}/answer-sheets`}
            className="text-blue-600 hover:underline font-medium"
          >
            &larr; Back to Answer Sheets
          </Link>
        </div>
      </div>
    );
  }

  const totalPenalties = calculateTotalPenalty(stage.scoreKey, sheet.answers);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Answer Sheet Scoring</h1>

      <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200">
        <div className="p-8">
          <h2 className="text-3xl font-bold mb-2 text-gray-800">
            Participant {sheet.eq}&apos;s Answers for {stage.name}
          </h2>
          <p className="text-xl font-semibold mb-6 text-red-600">
            Total Penalties: {totalPenalties} points
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-purple-100">
                  <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Row</th>
                  <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 1</th>
                  <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 2</th>
                  <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 3</th>
                  <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 4</th>
                  <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Penalties</th>
                </tr>
              </thead>
              <tbody>
                {stage.scoreKey.map((row) => {
                  const participantRow = findParticipantAnswer(row.rowNumber);
                  const rowPenalties = calculateRowPenalty(row, participantRow);

                  return (
                    <tr key={row.rowNumber} className={row.rowNumber % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="py-4 px-6 border-2 border-gray-300 font-bold text-xl text-gray-800">{row.rowNumber}</td>
                      {[0, 1, 2, 3].map((colIndex) => {
                        const answer = participantRow?.selectedAnswers[colIndex] || '';
                        const isCorrect = isAnswerCorrect(row.rowNumber, colIndex, answer);
                        const isFalse = isAnswerFalse(row.rowNumber, colIndex, answer);

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
                          <td key={colIndex} className="py-4 px-6 border-2 border-gray-300">
                            {answer ? (
                              <div
                                className={`w-16 h-16 flex items-center justify-center rounded-lg shadow-md border-2 ${cellClass} ${borderClass}`}
                              >
                                <span className="text-3xl font-bold">{answer}</span>
                              </div>
                            ) : (
                              <div className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded-lg shadow-md border-2 border-gray-300">
                                <span className="text-2xl text-gray-400">-</span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-4 px-6 border-2 border-gray-300">
                        {rowPenalties > 0 ? (
                          <div className="px-4 py-2 bg-red-100 text-red-800 rounded-lg shadow-sm border border-red-300 font-bold text-xl text-center">
                            {rowPenalties} {rowPenalties === 1 ? 'point' : 'points'}
                          </div>
                        ) : (
                          <div className="px-4 py-2 bg-green-100 text-green-800 rounded-lg shadow-sm border border-green-300 font-bold text-xl text-center">
                            0 points
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="p-4 bg-gray-50 border-t border-gray-200">
          <div className="flex justify-between">
            <Link
              href={`/rallies/${rallyId}/answer-sheets`}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              &larr; Back to Answer Sheets
            </Link>
            <Link
              href={`/rallies/${rallyId}`}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Rally Overview &rarr;
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnswerSheetScoringView;
