'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AnswerSheetForm from '../../../../../components/AnswerSheetForm';
import type { AnswerSheetInitialData } from '../../../../../components/AnswerSheetForm';
import type { StageTimeConfig, TimeKeyRow } from '../../../../../lib/timeScoring';
import type { ClassificationValue } from '../../../../../lib/participants';

interface Stage {
  _id: string;
  name: string;
  // The order flags of the key, so the entry grid can mark the rows whose
  // letters are scored on their order too.
  scoreKey?: { rowNumber: number; orderMatters?: boolean }[];
  timeScoreKey?: TimeKeyRow[];
  timeConfig?: Partial<StageTimeConfig>;
}

interface AnswerSheet extends AnswerSheetInitialData {
  _id: string;
  rallyId: string;
}

// Only used to label the EQ number on the card being corrected.
interface Participant {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

// Correcting an already submitted sheet. The card is the same one it was typed
// on, filled in with what is stored: officials copy paper cards, so a typo is
// fixed by retyping the row, not by deleting the sheet.
export default function EditAnswerSheetPage({
  params,
}: {
  params: Promise<{ id: string; sheetId: string }>;
}) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState<string>('');
  const [sheetId, setSheetId] = useState<string>('');
  const [rallyName, setRallyName] = useState<string>('');
  const [stages, setStages] = useState<Stage[]>([]);
  const [sheets, setSheets] = useState<AnswerSheet[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sheet, setSheet] = useState<AnswerSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
      setSheetId(resolved.sheetId);
    };
    getParams();
  }, [params]);

  const loadData = useCallback(async () => {
    if (!rallyId || !sheetId) return;
    try {
      setLoading(true);
      const [sheetRes, rallyRes, stagesRes, sheetsRes, participantsRes] = await Promise.all([
        fetch(`/api/answersheets/${sheetId}`),
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/stages?rallyId=${rallyId}`),
        fetch(`/api/answersheets?rallyId=${rallyId}`),
        fetch(`/api/rallies/${rallyId}/participants`),
      ]);

      if (!sheetRes.ok) throw new Error('Failed to fetch answer sheet');
      const sheetData: AnswerSheet = await sheetRes.json();

      // The sheet is addressed through a rally in the URL; refuse to edit it
      // from a rally it does not belong to.
      if (String(sheetData.rallyId) !== rallyId) {
        setError('This answer sheet belongs to another rally.');
        return;
      }
      setSheet(sheetData);

      if (rallyRes.ok) setRallyName((await rallyRes.json()).name || '');
      if (stagesRes.ok) setStages(await stagesRes.json());
      // The time penalty of a stage depends on the delta carried out of the
      // earlier ones, so the live preview needs the participant's other sheets.
      if (sheetsRes.ok) setSheets(await sheetsRes.json());
      if (participantsRes.ok) setParticipants(await participantsRes.json());
    } catch (err) {
      setError('Failed to load this answer sheet. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId, sheetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async (answerSheet: {
    eq: number;
    stageId: string;
    answers: { rowNumber: number; selectedAnswers: string[]; strafp: number }[];
    timePenalties: { rowNumber: number; wpt: string }[];
    merkScores: { rowNumber: number; merk: string; strafp: number }[];
  }) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/answersheets/${sheetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eq: answerSheet.eq,
          answers: answerSheet.answers,
          timePenalties: answerSheet.timePenalties,
          merkScores: answerSheet.merkScores,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update answer sheet');
      }

      router.push(`/rallies/${rallyId}/answer-sheets/${sheetId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to update answer sheet. Please try again.');
      console.error(err);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        <p className="ml-4 text-lg font-medium">Loading answer sheet...</p>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">
            {error || 'Answer sheet not found'}
          </p>
          <Link
            href={`/rallies/${rallyId}/answer-sheets`}
            className="text-blue-600 hover:underline text-lg"
          >
            Back to Answer Sheets
          </Link>
        </div>
      </div>
    );
  }

  const stageName = stages.find((stage) => stage._id === String(sheet.stageId))?.name || 'Unknown Stage';

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className="max-w-[1700px] mx-auto px-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Edit Answer Sheet — Participant {sheet.eq}, {stageName}
            {rallyName ? ` (${rallyName})` : ''}
          </h1>
          <p className="text-gray-700 text-base">
            Change what was typed in and save. The sheet is re-scored against the stage answer key,
            and the time penalties of this participant&apos;s later stages follow the corrected
            delta.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-6 py-3 rounded-lg mb-4 text-base font-medium shadow-md">
            <p>{error}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-6">
          <div className="px-6 py-3 border-b-2 border-gray-200">
            <h2 className="text-lg font-bold text-gray-800">Controlekaart</h2>
          </div>
          <div className="p-4">
            <AnswerSheetForm
              onSubmit={handleSubmit}
              stages={stages}
              sheets={sheets}
              participants={participants}
              initialData={{
                eq: sheet.eq,
                stageId: String(sheet.stageId),
                answers: sheet.answers,
                timePenalties: sheet.timePenalties,
                merkScores: sheet.merkScores,
              }}
              isEditing
            />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-6">
          <Link
            href={`/rallies/${rallyId}/answer-sheets/${sheetId}`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            &larr; Cancel
          </Link>
          <Link
            href={`/rallies/${rallyId}/answer-sheets`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            All Answer Sheets &rarr;
          </Link>
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full">
            <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-2xl font-bold text-center text-gray-800">Saving answer sheet...</p>
          </div>
        </div>
      )}
    </div>
  );
}
