import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { calculateTotalPenalty } from '../lib/scoring';
import type { AnswerRow, ScoreKeyRow } from '../lib/scoring';
import ControlekaartCard, { sumStrafp } from './ControlekaartCard';
import type { MerkScoreRow, TimePenaltyRow } from './ControlekaartCard';

interface Rally {
  _id: string;
  name: string;
}

interface Stage {
  _id: string;
  name: string;
  createdAt: string;
  scoreKey: ScoreKeyRow[];
}

interface AnswerSheet {
  _id: string;
  eq: number;
  stageId: string;
  answers: AnswerRow[];
  timePenalties?: TimePenaltyRow[];
  merkScores?: MerkScoreRow[];
  totalPenalty: number;
  timePenalty?: number;
  disqualified?: boolean;
  submittedAt: string;
}

interface ParticipantAnswersViewProps {
  rallyId: string;
  eq: number;
}

const formatDate = (dateString: string) =>
  new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// Everything one participant submitted for a rally: their answers for every
// stage, stage by stage, scored against each stage's answer key. Each stage is
// laid out as the four columns of the SARK controlekaart — ORC's 1-15, ORC's
// 16-30, the officials' time column and Merk + totals — so it reads like the
// paper card the answers were copied from. Stages the participant has no sheet
// for are listed as missing so the gaps are visible.
const ParticipantAnswersView: React.FC<ParticipantAnswersViewProps> = ({ rallyId, eq }) => {
  const [rally, setRally] = useState<Rally | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [sheets, setSheets] = useState<AnswerSheet[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [rallyRes, stagesRes, sheetsRes] = await Promise.all([
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/stages?rallyId=${rallyId}`),
        fetch(`/api/answersheets?rallyId=${rallyId}&eq=${eq}`),
      ]);

      if (!rallyRes.ok) throw new Error('Failed to fetch rally');
      setRally(await rallyRes.json());

      if (!stagesRes.ok) throw new Error('Failed to fetch stages');
      setStages(await stagesRes.json());

      if (!sheetsRes.ok) throw new Error('Failed to fetch answer sheets');
      setSheets(await sheetsRes.json());
    } catch (err) {
      setError('Failed to load this participant. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId, eq]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        <p className="ml-4 text-lg font-medium">Loading participant...</p>
      </div>
    );
  }

  if (error || !rally) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Rally not found'}</p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  // Stage order (creation order) is the running order of the rally, so the
  // participant's sheets read like their route through the event.
  //
  // Penalties are recomputed from the stage answer keys rather than read from
  // the stored totals, so every number on the page — row, stage and grand total
  // — comes from the same source even if a key was edited after submission.
  const sheetsByStage = new Map(sheets.map((sheet) => [sheet.stageId, sheet]));
  const entries = stages.map((stage) => {
    const sheet = sheetsByStage.get(stage._id);
    const timeRows = sheet?.timePenalties || [];
    const merkRows = sheet?.merkScores || [];

    return {
      stage,
      sheet,
      timeRows,
      merkRows,
      orcPenalty: sheet ? calculateTotalPenalty(stage.scoreKey, sheet.answers) : 0,
      tijdTotal: sumStrafp(timeRows),
      diversenTotal: sumStrafp(merkRows),
    };
  });

  const orcTotal = entries.reduce((total, entry) => total + entry.orcPenalty, 0);
  const tijdTotal = entries.reduce((total, entry) => total + entry.tijdTotal, 0);
  const diversenTotal = entries.reduce((total, entry) => total + entry.diversenTotal, 0);
  const disqualified = sheets.some((sheet) => sheet.disqualified);

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className="max-w-[1700px] mx-auto p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Participant {eq} — {rally.name}
          </h1>
          <p className="text-gray-700 text-base">
            Every answer this participant submitted, stage by stage, scored against each stage&apos;s
            answer key.
          </p>
        </div>

        {/* Summary */}
        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
            <div className="p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Participant (EQ)
              </p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{eq}</p>
            </div>
            <div className="p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Sheets Submitted
              </p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {sheets.length}
                {stages.length > 0 ? ` / ${stages.length}` : ''}
              </p>
            </div>
            <div className="p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Strafpunten
              </p>
              <p className="text-3xl font-bold text-red-600 mt-1">{orcTotal + tijdTotal}</p>
              <p className="text-sm text-gray-600 mt-1">
                ORC&apos;s {orcTotal} + Tijd {tijdTotal} — counts for the standings
              </p>
            </div>
            <div className="p-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Diversen
              </p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{diversenTotal}</p>
              <p className="text-sm text-gray-600 mt-1">Recorded by the officials</p>
            </div>
          </div>
        </div>

        {disqualified && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-800 px-6 py-3 rounded-lg mb-6 text-base font-bold shadow-md">
            Disqualified — this participant passed the finish of the last stage outside its window.
          </div>
        )}

        {stages.length === 0 ? (
          <div className="bg-white rounded-xl shadow-xl p-12 text-center">
            <p className="text-xl text-gray-700">
              This rally has no stages yet, so there is nothing for this participant to submit.
            </p>
          </div>
        ) : (
          entries.map(({ stage, sheet, orcPenalty, tijdTotal: stageTijdTotal }) => {
            if (!sheet) {
              return (
                <div
                  key={stage._id}
                  className="bg-white rounded-xl shadow-lg border-2 border-dashed border-gray-300 p-6 mb-6"
                >
                  <h2 className="text-lg font-bold text-gray-800">{stage.name}</h2>
                  <p className="text-base text-gray-700 mt-1">
                    No answer sheet submitted for this stage.
                  </p>
                  <Link
                    href={`/rallies/${rallyId}/answer-sheets`}
                    className="text-blue-600 hover:underline font-medium text-base mt-2 inline-block"
                  >
                    Enter an answer sheet &rarr;
                  </Link>
                </div>
              );
            }

            return (
              <div
                key={stage._id}
                className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200 mb-6"
              >
                <div className="px-6 py-3 border-b-2 border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">{stage.name}</h2>
                    <p className="text-sm text-gray-600">
                      Submitted: {formatDate(sheet.submittedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-bold text-red-600">
                      {orcPenalty + stageTijdTotal} penalty points
                      <span className="ml-2 text-sm font-semibold text-gray-600">
                        (ORC&apos;s {orcPenalty} + Tijd {stageTijdTotal})
                      </span>
                    </span>
                    <Link
                      href={`/rallies/${rallyId}/answer-sheets/${sheet._id}`}
                      className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium text-base transition-colors"
                    >
                      View Score
                    </Link>
                  </div>
                </div>

                <ControlekaartCard
                  scoreKey={stage.scoreKey}
                  answers={sheet.answers}
                  timePenalties={sheet.timePenalties}
                  merkScores={sheet.merkScores}
                  disqualified={sheet.disqualified}
                />
              </div>
            );
          })
        )}

        <div className="mt-8 flex flex-wrap gap-6">
          <Link
            href={`/rallies/${rallyId}`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            &larr; Back to Rally
          </Link>
          <Link
            href={`/rallies/${rallyId}/answer-sheets`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            Answer Sheets &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ParticipantAnswersView;
