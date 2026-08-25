'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AnswerSheetForm from '../../../components/AnswerSheetForm';
import { type ClassificationValue } from '../../../lib/participants';
import type { ScoreKeyRow } from '../../../lib/scoring';
import { PAGE_CONTAINER } from '../../../lib/layout';

interface Rally {
  _id: string;
  name: string;
}

interface Stage {
  _id: string;
  name: string;
  // The full ORC key: the entry grid scores every row against it while the card
  // is typed — the strafpunten are computed, not entered — and marks the rows
  // whose letters are scored on their order too.
  scoreKey?: ScoreKeyRow[];
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

// The sheets the rally already holds. They are not listed on this page — the
// standings, the stage view and the per-participant view are where a submitted
// card is read — but the entry form needs them: it greys out the crews that
// already have a sheet for the chosen stage and it chains the delta of the
// earlier stages into its live time preview.
interface AnswerSheet {
  _id: string;
  eq: number;
  stageId: string;
  timePenalties?: { rowNumber: number; wpt?: string }[];
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

      // The entry list the entry form picks from — a card can only be typed
      // for a crew the rally knows.
      if (participantsRes.ok) setParticipants(await participantsRes.json());

      if (stagesRes.ok) setStages(await stagesRes.json());

      if (sheetsRes.ok) setSheets(await sheetsRes.json());
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

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className={PAGE_CONTAINER}>
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Answer Sheets{rally ? ` — ${rally.name}` : ''}
          </h1>
          <p className="text-gray-700 text-base">
            Type a participant&apos;s control card for one of the stages of this rally.
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
            {loading ? (
              <div className="text-center p-12">
                <p className="text-xl text-gray-600">Loading rally&hellip;</p>
              </div>
            ) : stages.length === 0 ? (
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
