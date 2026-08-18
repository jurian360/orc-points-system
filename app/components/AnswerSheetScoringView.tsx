import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { calculateTotalPenalty } from '../lib/scoring';
import type { AnswerRow, ScoreKeyRow } from '../lib/scoring';
import OrcAnswerGrid from './OrcAnswerGrid';

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
          <p className="text-xl font-semibold mb-2 text-red-600">
            Total Penalties: {totalPenalties} points
          </p>
          <p className="mb-6">
            <Link
              href={`/rallies/${rallyId}/participants/${sheet.eq}`}
              className="text-blue-600 hover:underline font-medium"
            >
              See all answers submitted by participant {sheet.eq} &rarr;
            </Link>
          </p>

          {/* Answers laid out as two ORC's columns, like the physical controlekaart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <OrcAnswerGrid scoreKey={stage.scoreKey} answers={sheet.answers} />
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
