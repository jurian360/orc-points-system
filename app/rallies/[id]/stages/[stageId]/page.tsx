'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import StageKeyCard from '../../../../components/StageKeyCard';
import type { StageMerkKeyRow, StageScoreKeyRow } from '../../../../components/StageKeyCard';
import type { StageTimeConfig, TimeKeyRow } from '../../../../lib/timeScoring';

interface Stage {
  _id: string;
  rallyId: string;
  name: string;
  createdAt: string;
  scoreKey: StageScoreKeyRow[];
  timeScoreKey?: TimeKeyRow[];
  merkScoreKey?: StageMerkKeyRow[];
  timeConfig?: Partial<StageTimeConfig>;
}

export default function ViewStagePage({
  params,
}: {
  params: Promise<{ id: string; stageId: string }>;
}) {
  const [rallyId, setRallyId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [stage, setStage] = useState<Stage | null>(null);
  // Whether this is the last stage of the rally decides what its finish row
  // does — a penalty plus the break, or a disqualification — and so the maximum
  // the stage can hand out.
  const [isFinalStage, setIsFinalStage] = useState(true);
  const [loading, setLoading] = useState(true);
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
        <p className="text-lg font-semibold">Loading stage...</p>
      </div>
    );
  }

  if (error || !stage) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Stage not found'}</p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className="max-w-[1700px] mx-auto p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{stage.name}</h1>
          <p className="text-gray-700 text-base">
            Answer key of this stage, laid out as the controlekaart. Created:{' '}
            {formatDate(stage.createdAt)}
            {isFinalStage ? ' — last stage of the rally.' : ''}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200 mb-6">
          <div className="px-6 py-3 border-b-2 border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <h2 className="text-lg font-bold text-gray-800">Answer Key</h2>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/rallies/${rallyId}/stages/${stage._id}/qr-codes`}
                className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium text-base transition-colors"
              >
                QR Codes
              </Link>
              <Link
                href={`/time-import?rallyId=${rallyId}&stageId=${stage._id}`}
                className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-base transition-colors"
              >
                Import Times
              </Link>
              <Link
                href={`/rallies/${rallyId}/stages/${stage._id}/edit`}
                className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-base transition-colors"
              >
                Edit Stage
              </Link>
            </div>
          </div>

          {/* Same 4 columns as the stage form and the scored sheets */}
          <StageKeyCard
            scoreKey={stage.scoreKey}
            timeScoreKey={stage.timeScoreKey}
            merkScoreKey={stage.merkScoreKey}
            timeConfig={stage.timeConfig}
            isFinalStage={isFinalStage}
          />
        </div>

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
}
