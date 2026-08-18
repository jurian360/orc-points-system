import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { calculateTotalPenalty } from '../lib/scoring';
import type { AnswerRow, ScoreKeyRow } from '../lib/scoring';
import ControlekaartCard from './ControlekaartCard';
import type { MerkScoreRow, TimePenaltyRow } from './ControlekaartCard';

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
  timePenalties?: TimePenaltyRow[];
  merkScores?: MerkScoreRow[];
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

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        <p className="ml-4 text-lg font-medium">Loading...</p>
      </div>
    );
  }

  if (error || !stage || !sheet) {
    return (
      <div className="min-h-screen bg-gray-100 py-4">
        <div className="max-w-[1700px] mx-auto p-4">
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
      </div>
    );
  }

  const totalPenalties = calculateTotalPenalty(stage.scoreKey, sheet.answers);

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className="max-w-[1700px] mx-auto p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Participant {sheet.eq}&apos;s Answers — {stage.name}
          </h1>
          <p className="text-gray-700 text-base">
            Scored against the stage answer key. Submitted: {formatDate(sheet.submittedAt)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200 mb-6">
          <div className="px-6 py-3 border-b-2 border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <h2 className="text-lg font-bold text-gray-800">Answer Sheet Scoring</h2>
            <div className="flex items-center gap-4">
              <span className="text-lg font-bold text-red-600">
                {totalPenalties} penalty points
              </span>
              <Link
                href={`/rallies/${rallyId}/participants/${sheet.eq}`}
                className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium text-base transition-colors"
              >
                All Answers of Participant {sheet.eq}
              </Link>
            </div>
          </div>

          {/* Same 4 columns as the entry form and the participant view */}
          <ControlekaartCard
            scoreKey={stage.scoreKey}
            answers={sheet.answers}
            timePenalties={sheet.timePenalties}
            merkScores={sheet.merkScores}
          />
        </div>

        <div className="mt-8 flex flex-wrap gap-6">
          <Link
            href={`/rallies/${rallyId}/answer-sheets`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            &larr; Back to Answer Sheets
          </Link>
          <Link
            href={`/rallies/${rallyId}`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            Rally Overview &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AnswerSheetScoringView;
