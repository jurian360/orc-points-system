'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StageForm from '../../../../../components/StageForm';

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
    maxPenalty?: number;
  }[];
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
    if (!stageId) return;

    const fetchStage = async () => {
      try {
        const response = await fetch(`/api/stages/${stageId}`);
        if (!response.ok) throw new Error('Failed to fetch stage');
        setStage(await response.json());
      } catch (err) {
        setError('Failed to load stage. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchStage();
  }, [stageId]);

  const handleSubmit = async (
    stageName: string,
    scoreKey: any[],
    timeScoreKey: any[],
    merkScoreKey: any[]
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
      <div className="max-w-[1700px] mx-auto p-4">
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
          {stage && <StageForm onSubmit={handleSubmit} initialData={stage} isEditing={true} />}
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
