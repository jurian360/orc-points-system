'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StageForm from '../../../../../components/StageForm';
import { PAGE_CONTAINER } from '../../../../../lib/layout';

interface Stage {
  _id: string;
  name: string;
  scoreKey: {
    rowNumber: number;
    answers: string[];
    falseAnswers?: { column: number; value: string }[];
    maxPenalty?: number;
  }[];
  timeScoreKey?: {
    rowNumber: number;
    ipt: string;
    wpt: string;
    plusMinus: string;
    maxPenalty?: number;
  }[];
  merkScoreKey?: {
    rowNumber: number;
    merk: string;
    // The letter this key rules out anywhere in the merk column.
    falseMerk?: string;
    maxPenalty?: number;
  }[];
  timeConfig?: {
    breakMinutes: number;
    gtcEarlyWindow: number;
    gtcLateWindow: number;
    finishEarlyWindow: number;
    finishLateWindow: number;
    outOfWindowPenalty: number;
    missingFinishPenalty: number;
  };
}

export default function EditStagePage({
  params,
}: {
  params: Promise<{ id: string; stageId: string }>;
}) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [stage, setStage] = useState<Stage | null>(null);
  // Whether this is the last stage of the rally decides what its finish row
  // does — a penalty plus the break, or a disqualification.
  const [isFinalStage, setIsFinalStage] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
      setStageId(resolved.stageId);
    };
    getParams();
  }, [params]);

  useEffect(() => {
    if (!stageId || !rallyId) return;

    const fetchStage = async () => {
      try {
        const [stageRes, stagesRes] = await Promise.all([
          fetch(`/api/stages/${stageId}`),
          fetch(`/api/stages?rallyId=${rallyId}`),
        ]);
        if (!stageRes.ok) throw new Error('Failed to fetch stage');
        setStage(await stageRes.json());

        if (stagesRes.ok) {
          // Stages are returned in running order (creation order).
          const stages: { _id: string }[] = await stagesRes.json();
          setIsFinalStage(stages.length === 0 || stages[stages.length - 1]._id === stageId);
        }
      } catch (err) {
        setError('Failed to load stage. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchStage();
  }, [stageId, rallyId]);

  const handleSubmit = async (
    stageName: string,
    scoreKey: any[],
    timeScoreKey: any[],
    merkScoreKey: any[],
    timeConfig: any
  ) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/stages/${stageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: stageName,
          scoreKey,
          timeScoreKey,
          merkScoreKey,
          timeConfig,
        }),
      });

      if (!response.ok) throw new Error('Failed to update stage');

      router.push(`/rallies/${rallyId}`);
    } catch (err) {
      setError('Failed to update stage. Please try again.');
      console.error(err);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>Loading stage...</p>
      </div>
    );
  }

  if (error && !stage) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className={`${PAGE_CONTAINER} py-4`}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Edit Stage</h1>
          <p className="text-gray-600 mt-2">Edit the stage name and its answer key.</p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          {stage && (
            <StageForm
              onSubmit={handleSubmit}
              initialData={stage}
              isEditing={true}
              isFinalStage={isFinalStage}
            />
          )}
        </div>

        <div className="mt-6">
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline">
            &larr; Back to Rally
          </Link>
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-4 rounded-lg">
            <p className="text-lg">Updating stage...</p>
          </div>
        </div>
      )}
    </div>
  );
}
