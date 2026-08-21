import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { calculateTotalPenalty } from '../lib/scoring';
import type { AnswerRow, ScoreKeyRow } from '../lib/scoring';
import ControlekaartCard, { sumStrafp } from './ControlekaartCard';
import type { MerkScoreRow, TimePenaltyRow } from './ControlekaartCard';
import ClassificationBadge from './ClassificationBadge';
import { crewLabel, type ClassificationValue } from '../lib/participants';

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
  timePenalty?: number;
  disqualified?: boolean;
  submittedAt: string;
}

// The crew behind the EQ of this sheet, when it has been recorded.
interface ParticipantDetails {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

interface AnswerSheetScoringViewProps {
  rallyId: string;
  sheetId: string;
}

const AnswerSheetScoringView: React.FC<AnswerSheetScoringViewProps> = ({ rallyId, sheetId }) => {
  const router = useRouter();
  const [stage, setStage] = useState<Stage | null>(null);
  const [sheet, setSheet] = useState<AnswerSheet | null>(null);
  const [details, setDetails] = useState<ParticipantDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

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

        // A 404 only means nobody has recorded who this EQ is; the sheet is
        // scored either way.
        const detailsRes = await fetch(
          `/api/rallies/${sheetData.rallyId}/participants/${sheetData.eq}`
        );
        setDetails(detailsRes.ok ? await detailsRes.json() : null);
      } catch (err) {
        setError('Failed to load answer sheet scoring.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sheetId]);

  // Deleting this sheet re-scores the rest of the participant's rally, so the
  // list is where the corrected numbers show up.
  const handleDelete = async () => {
    if (
      !window.confirm(
        'Delete this answer sheet? The participant keeps their sheets for the other stages. This cannot be undone.'
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const response = await fetch(`/api/answersheets/${sheetId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete answer sheet');
      router.push(`/rallies/${rallyId}/answer-sheets`);
    } catch (err) {
      setError('Failed to delete this answer sheet. Please try again.');
      console.error(err);
      setDeleting(false);
    }
  };

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

  // ORC's + Tijd, the two parts the standings are built from.
  const orcPenalty = calculateTotalPenalty(stage.scoreKey, sheet.answers);
  const tijdPenalty = sumStrafp(sheet.timePenalties || []);
  const totalPenalties = orcPenalty + tijdPenalty;

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className="max-w-[1700px] mx-auto p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Participant {sheet.eq}&apos;s Answers — {stage.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <ClassificationBadge
              classification={details?.classification}
              fallback="No classification"
            />
            <span className="text-gray-700 text-base">
              {crewLabel(details) || 'No participant details recorded yet.'}
            </span>
          </div>
          <p className="text-gray-700 text-base">
            Scored against the stage answer key. Submitted: {formatDate(sheet.submittedAt)}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200 mb-6">
          <div className="px-6 py-3 border-b-2 border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <h2 className="text-lg font-bold text-gray-800">Answer Sheet Scoring</h2>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-lg font-bold text-red-600">
                {totalPenalties} penalty points
                <span className="ml-2 text-sm font-semibold text-gray-600">
                  (ORC&apos;s {orcPenalty} + Tijd {tijdPenalty})
                </span>
              </span>
              {sheet.disqualified && (
                <span className="px-2 py-1 rounded bg-red-100 text-red-800 text-sm font-bold">
                  DQ
                </span>
              )}
              <Link
                href={`/rallies/${rallyId}/participants/${sheet.eq}`}
                className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium text-base transition-colors"
              >
                All Answers of Participant {sheet.eq}
              </Link>
              <Link
                href={`/rallies/${rallyId}/answer-sheets/${sheet._id}/edit`}
                className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-base transition-colors"
              >
                Edit Answers
              </Link>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-base transition-colors disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete Sheet'}
              </button>
            </div>
          </div>

          {/* Same 4 columns as the entry form and the participant view */}
          <ControlekaartCard
            scoreKey={stage.scoreKey}
            answers={sheet.answers}
            timePenalties={sheet.timePenalties}
            merkScores={sheet.merkScores}
            disqualified={sheet.disqualified}
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
