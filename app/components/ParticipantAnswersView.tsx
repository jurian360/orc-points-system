import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { calculateTotalPenalty } from '../lib/scoring';
import type { AnswerRow, ScoreKeyRow } from '../lib/scoring';
import OrcAnswerGrid from './OrcAnswerGrid';

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

interface TimePenaltyRow {
  rowNumber: number;
  ipt?: string;
  wpt?: string;
  plusMinus?: string;
  strafp?: number;
}

interface MerkScoreRow {
  rowNumber: number;
  merk?: string;
  strafp?: number;
}

interface AnswerSheet {
  _id: string;
  eq: number;
  stageId: string;
  answers: AnswerRow[];
  timePenalties?: TimePenaltyRow[];
  merkScores?: MerkScoreRow[];
  totalPenalty: number;
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

// A row is only worth showing when the officials actually filled something in.
const hasTimeEntry = (row: TimePenaltyRow) =>
  Boolean(row.ipt || row.wpt || row.plusMinus) || (row.strafp || 0) > 0;

const hasMerkEntry = (row: MerkScoreRow) => Boolean(row.merk) || (row.strafp || 0) > 0;

// Everything one participant submitted for a rally: their answers for every
// stage, stage by stage, scored against each stage's answer key. Stages the
// participant has no sheet for are listed as missing so the gaps are visible.
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        <p className="ml-4 text-lg font-medium">Loading participant...</p>
      </div>
    );
  }

  if (error || !rally) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
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
    return {
      stage,
      sheet,
      penalty: sheet ? calculateTotalPenalty(stage.scoreKey, sheet.answers) : 0,
    };
  });
  const scoredTotal = entries.reduce((total, entry) => total + entry.penalty, 0);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800">Participant {eq}</h1>
          <p className="text-gray-600 mt-1 text-lg">
            Answers submitted for {rally.name}
          </p>
        </div>

        {/* Summary */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
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
                Total Penalty
              </p>
              <p className="text-3xl font-bold text-red-600 mt-1">{scoredTotal}</p>
            </div>
          </div>
        </div>

        {stages.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-lg text-gray-600">
              This rally has no stages yet, so there is nothing for this participant to submit.
            </p>
          </div>
        ) : (
          entries.map(({ stage, sheet, penalty }) => {
            if (!sheet) {
              return (
                <div
                  key={stage._id}
                  className="bg-white rounded-lg shadow-lg border-2 border-dashed border-gray-300 p-6 mb-6"
                >
                  <h2 className="text-2xl font-semibold text-gray-800">{stage.name}</h2>
                  <p className="text-lg text-gray-600 mt-2">
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

            const timeRows = (sheet.timePenalties || []).filter(hasTimeEntry);
            const merkRows = (sheet.merkScores || []).filter(hasMerkEntry);

            return (
              <div
                key={stage._id}
                className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200 mb-6"
              >
                <div className="px-6 py-4 border-b-2 border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                  <div>
                    <h2 className="text-2xl font-semibold text-gray-800">{stage.name}</h2>
                    <p className="text-base text-gray-600 mt-1">
                      Submitted: {formatDate(sheet.submittedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-bold text-red-600">
                      {penalty} penalty points
                    </span>
                    <Link
                      href={`/rallies/${rallyId}/answer-sheets/${sheet._id}`}
                      className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium text-base transition-colors"
                    >
                      View Score
                    </Link>
                  </div>
                </div>

                <div className="p-6">
                  <OrcAnswerGrid scoreKey={stage.scoreKey} answers={sheet.answers} />

                  {(timeRows.length > 0 || merkRows.length > 0) && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start mt-6">
                      {timeRows.length > 0 && (
                        <div>
                          <h3 className="text-sm font-bold mb-1 text-gray-800">
                            For Official Use Only (time)
                          </h3>
                          <div className="overflow-x-auto">
                            <table className="min-w-full border-collapse">
                              <thead>
                                <tr className="bg-yellow-100">
                                  <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800 w-10">NR</th>
                                  <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">IPT 0</th>
                                  <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">WPT</th>
                                  <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">+/-</th>
                                  <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">Strafp.</th>
                                </tr>
                              </thead>
                              <tbody>
                                {timeRows.map((row) => (
                                  <tr
                                    key={row.rowNumber}
                                    className={row.rowNumber % 2 === 0 ? 'bg-gray-50' : 'bg-white'}
                                  >
                                    <td className="py-1.5 px-2 border-2 border-gray-300 font-bold text-base text-gray-800 text-center">
                                      {row.rowNumber}
                                    </td>
                                    <td className="py-1.5 px-2 border-2 border-gray-300 text-center text-base text-gray-800">
                                      {row.ipt || '-'}
                                    </td>
                                    <td className="py-1.5 px-2 border-2 border-gray-300 text-center text-base text-gray-800">
                                      {row.wpt || '-'}
                                    </td>
                                    <td className="py-1.5 px-2 border-2 border-gray-300 text-center text-base text-gray-800">
                                      {row.plusMinus || '-'}
                                    </td>
                                    <td className="py-1.5 px-2 border-2 border-gray-300 text-center text-base font-bold text-gray-900">
                                      {row.strafp || 0}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {merkRows.length > 0 && (
                        <div>
                          <h3 className="text-sm font-bold mb-1 text-gray-800">Merk</h3>
                          <div className="overflow-x-auto">
                            <table className="min-w-full border-collapse">
                              <thead>
                                <tr className="bg-orange-100">
                                  <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800 w-10">NR</th>
                                  <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">Merk</th>
                                  <th className="py-2 px-2 border-2 border-gray-300 text-center font-bold text-sm text-gray-800">Strafp.</th>
                                </tr>
                              </thead>
                              <tbody>
                                {merkRows.map((row) => (
                                  <tr
                                    key={row.rowNumber}
                                    className={row.rowNumber % 2 === 0 ? 'bg-gray-50' : 'bg-white'}
                                  >
                                    <td className="py-1.5 px-2 border-2 border-gray-300 font-bold text-base text-gray-800 text-center">
                                      {row.rowNumber}
                                    </td>
                                    <td className="py-1.5 px-2 border-2 border-gray-300 text-base text-gray-800">
                                      {row.merk || '-'}
                                    </td>
                                    <td className="py-1.5 px-2 border-2 border-gray-300 text-center text-base font-bold text-gray-900">
                                      {row.strafp || 0}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(timeRows.length > 0 || merkRows.length > 0) && (
                    <p className="text-sm text-gray-600 mt-3">
                      Time and merk strafpunten are recorded by the officials; the standings are
                      scored from the ORC answers above.
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}

        <div className="mt-8 flex flex-wrap gap-6">
          <Link
            href={`/rallies/${rallyId}`}
            className="text-blue-600 hover:underline text-lg font-medium"
          >
            &larr; Back to Rally
          </Link>
          <Link
            href={`/rallies/${rallyId}/answer-sheets`}
            className="text-blue-600 hover:underline text-lg font-medium"
          >
            Answer Sheets &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ParticipantAnswersView;
