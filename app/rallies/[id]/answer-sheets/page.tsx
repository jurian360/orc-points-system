'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AnswerSheetForm from '../../../components/AnswerSheetForm';
import ClassificationBadge from '../../../components/ClassificationBadge';
import { crewLabel, type ClassificationValue } from '../../../lib/participants';

interface Rally {
  _id: string;
  name: string;
}

interface Stage {
  _id: string;
  name: string;
  // The order flags of the key, so the entry grid can mark the rows whose
  // letters are scored on their order too.
  scoreKey?: { rowNumber: number; orderMatters?: boolean }[];
  timeScoreKey?: { rowNumber: number; ipt?: string }[];
  // The merk key: the entry form scores the merk column live against it.
  merkScoreKey?: { rowNumber: number; merk?: string; maxPenalty?: number }[];
  timeConfig?: Record<string, number>;
}

interface Participant {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

interface AnswerSheet {
  _id: string;
  eq: number;
  stageId: string;
  totalPenalty: number;
  timePenalty?: number;
  disqualified?: boolean;
  timePenalties?: { rowNumber: number; wpt?: string }[];
  submittedAt: string;
  stageName?: string;
}

export default function AnswerSheetsPage({ params }: { params: Promise<{ id: string }> }) {
  const [rallyId, setRallyId] = useState<string>('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [sheets, setSheets] = useState<AnswerSheet[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    getParams();
  }, [params]);

  const loadData = useCallback(async () => {
    if (!rallyId) return;
    try {
      setLoading(true);
      const [rallyRes, stagesRes, sheetsRes, participantsRes] = await Promise.all([
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/stages?rallyId=${rallyId}`),
        fetch(`/api/answersheets?rallyId=${rallyId}`),
        fetch(`/api/rallies/${rallyId}/participants`),
      ]);

      if (rallyRes.ok) setRally(await rallyRes.json());

      // Only used to label the EQ numbers — a card can be typed for an EQ that
      // has no participant record.
      if (participantsRes.ok) setParticipants(await participantsRes.json());

      let stagesData: Stage[] = [];
      if (stagesRes.ok) {
        stagesData = await stagesRes.json();
        setStages(stagesData);
      }

      if (sheetsRes.ok) {
        const sheetsData: AnswerSheet[] = await sheetsRes.json();
        const withStageName = sheetsData.map((sheet) => ({
          ...sheet,
          stageName: stagesData.find((s) => s._id === sheet.stageId)?.name || 'Unknown Stage',
        }));
        setSheets(withStageName);
      }
    } catch (err) {
      setError('Failed to load data. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (answerSheet: any) => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/answersheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answerSheet),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit answer sheet');
      }

      setSuccess('Answer sheet submitted successfully!');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to submit answer sheet. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (sheetId: string) => {
    if (
      !window.confirm(
        'Delete this answer sheet? The participant keeps their sheets for the other stages. This cannot be undone.'
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/answersheets/${sheetId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete answer sheet');
      setSuccess('Answer sheet deleted successfully!');
      // Deleting a sheet re-scores the rest of that participant's rally — their
      // delta no longer passes through this stage — so the table is reloaded
      // rather than filtered in place.
      loadData();
    } catch (err) {
      setError('Failed to delete answer sheet. Please try again.');
      console.error(err);
    }
  };

  // Removing a participant from the rally deletes their details and every sheet
  // they have in it.
  const handleDeleteParticipant = async (eq: number) => {
    if (
      !window.confirm(
        `Delete participant ${eq} from this rally? Their details and every answer sheet they submitted for it will be deleted. This cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/rallies/${rallyId}/participants/${eq}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete participant');
      setSuccess(`Participant ${eq} deleted from this rally.`);
      loadData();
    } catch (err) {
      setError('Failed to delete participant. Please try again.');
      console.error(err);
    }
  };

  const participantByEq = new Map(participants.map((participant) => [participant.eq, participant]));

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className="max-w-[1700px] mx-auto px-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Answer Sheets{rally ? ` — ${rally.name}` : ''}
          </h1>
          <p className="text-gray-700 text-base">
            Enter and manage participant answer sheets for the stages of this rally.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-6 py-3 rounded-lg mb-4 text-base font-medium shadow-md">
            <p>{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-100 border-l-4 border-green-500 text-green-800 px-6 py-3 rounded-lg mb-4 text-base font-medium shadow-md">
            <p>{success}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-6">
          <div className="px-6 py-3 border-b-2 border-gray-200">
            <h2 className="text-lg font-bold text-gray-800">Enter New Answer Sheet</h2>
          </div>
          <div className="p-4">
            {stages.length === 0 ? (
              <div className="text-center p-12 bg-gray-50 rounded-lg border-2 border-gray-200">
                <p className="mb-6 text-xl text-gray-700">
                  No stages available. Add a stage to this rally first.
                </p>
                <Link
                  href={`/rallies/${rallyId}/stages/new`}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-block text-lg font-bold shadow-md"
                >
                  Add Stage
                </Link>
              </div>
            ) : (
              <AnswerSheetForm
                onSubmit={handleSubmit}
                stages={stages}
                sheets={sheets}
                participants={participants}
              />
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-6">
          <div className="px-6 py-3 border-b-2 border-gray-200">
            <h2 className="text-lg font-bold text-gray-800">Submitted Answer Sheets</h2>
          </div>

          <div className="p-4">
            {loading ? (
              <div className="text-center p-12">
                <p className="text-xl text-gray-600">Loading answer sheets...</p>
              </div>
            ) : sheets.length === 0 ? (
              <div className="text-center p-12 bg-gray-50 rounded-lg border-2 border-gray-200">
                <p className="text-xl text-gray-700">No answer sheets submitted yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y-2 divide-gray-200 border-2 border-gray-200 rounded-lg">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-8 py-5 text-left text-base font-bold text-gray-800 uppercase border-b-2 border-r-2 border-gray-200">
                        Participant (EQ)
                      </th>
                      <th className="px-8 py-5 text-left text-base font-bold text-gray-800 uppercase border-b-2 border-r-2 border-gray-200">
                        Stage
                      </th>
                      <th className="px-8 py-5 text-left text-base font-bold text-gray-800 uppercase border-b-2 border-r-2 border-gray-200">
                        Tijd
                      </th>
                      <th className="px-8 py-5 text-left text-base font-bold text-gray-800 uppercase border-b-2 border-r-2 border-gray-200">
                        Penalty
                      </th>
                      <th className="px-8 py-5 text-left text-base font-bold text-gray-800 uppercase border-b-2 border-r-2 border-gray-200">
                        Submitted At
                      </th>
                      <th className="px-8 py-5 text-right text-base font-bold text-gray-800 uppercase border-b-2 border-gray-200">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {sheets.map((sheet) => (
                      <tr key={sheet._id} className="hover:bg-gray-50">
                        <td className="px-8 py-5 border-r-2 border-gray-200">
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/rallies/${rallyId}/participants/${sheet.eq}`}
                              className="text-2xl font-bold text-blue-600 hover:underline"
                              title={`Show all answers submitted by participant ${sheet.eq}`}
                            >
                              {sheet.eq}
                            </Link>
                            <ClassificationBadge
                              classification={participantByEq.get(sheet.eq)?.classification}
                            />
                          </div>
                          {crewLabel(participantByEq.get(sheet.eq)) && (
                            <div className="text-base text-gray-700 mt-1">
                              {crewLabel(participantByEq.get(sheet.eq))}
                            </div>
                          )}
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap border-r-2 border-gray-200">
                          <div className="text-lg text-gray-700">{sheet.stageName}</div>
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap border-r-2 border-gray-200">
                          <div className="text-lg text-gray-700">{sheet.timePenalty || 0}</div>
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap border-r-2 border-gray-200">
                          <div className="text-lg font-bold text-red-600">{sheet.totalPenalty}</div>
                          {sheet.disqualified && (
                            <span className="inline-block mt-1 px-2 py-0.5 rounded bg-red-100 text-red-800 text-sm font-bold">
                              DQ
                            </span>
                          )}
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap border-r-2 border-gray-200">
                          <div className="text-lg text-gray-700">{formatDate(sheet.submittedAt)}</div>
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap text-right">
                          <div className="flex justify-end flex-wrap gap-3">
                            <Link
                              href={`/rallies/${rallyId}/answer-sheets/${sheet._id}`}
                              className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium text-lg transition-colors"
                            >
                              View Score
                            </Link>
                            <Link
                              href={`/rallies/${rallyId}/answer-sheets/${sheet._id}/edit`}
                              className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-lg transition-colors"
                            >
                              Edit
                            </Link>
                            <button
                              onClick={() => handleDelete(sheet._id)}
                              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-lg transition-colors"
                            >
                              Delete Sheet
                            </button>
                            <button
                              onClick={() => handleDeleteParticipant(sheet.eq)}
                              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-lg transition-colors"
                              title={`Delete the details and every answer sheet of participant ${sheet.eq} in this rally`}
                            >
                              Delete EQ {sheet.eq}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8">
          <Link
            href={`/rallies/${rallyId}`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            &larr; Back to Rally
          </Link>
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full">
            <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-2xl font-bold text-center text-gray-800">Submitting answer sheet...</p>
          </div>
        </div>
      )}
    </div>
  );
}
