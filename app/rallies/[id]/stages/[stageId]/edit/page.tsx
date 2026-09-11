'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StageForm, {
  type StageFormInitialData,
  type StageFormPayload,
} from '../../../../../components/StageForm';
import { PAGE_CONTAINER } from '../../../../../lib/layout';
import { stageLegPosition, type RallyRoute } from '../../../../../lib/routes';

// The stage as the form is seeded with it. It is the form's own type rather than
// a copy of the shape: a copy written here was already quietly dropping the
// appeal answers and the volgorde ticks of every stage that had them, because a
// field this file did not declare never reached `initialData`.
type Stage = StageFormInitialData & { _id: string };

export default function EditStagePage({
  params,
}: {
  params: Promise<{ id: string; stageId: string }>;
}) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [routes, setRoutes] = useState<RallyRoute[]>([]);
  // Where the stage sits in the rally's legs decides what its finish row does:
  // a penalty plus the break, a penalty with no break at the end of a route, or
  // a disqualification at the end of the last one.
  const [position, setPosition] = useState({ endsRoute: true, endsRally: true });
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
        const [stageRes, stagesRes, routesRes] = await Promise.all([
          fetch(`/api/stages/${stageId}`),
          fetch(`/api/stages?rallyId=${rallyId}`),
          fetch(`/api/rallies/${rallyId}/routes`),
        ]);
        if (!stageRes.ok) throw new Error('Failed to fetch stage');
        setStage(await stageRes.json());

        if (routesRes.ok) {
          const data = await routesRes.json();
          setRoutes(data.routes || []);
        }

        if (stagesRes.ok) {
          // Stages come back in running order, so the legs are read straight off
          // the list (app/lib/routes.ts).
          const stages = await stagesRes.json();
          setPosition(stageLegPosition(stageId, stages));
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

  const handleSubmit = async (payload: StageFormPayload) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/stages/${stageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payload.name,
          // Only sent on a rally that has routes. Leaving it out of the body is
          // what tells the API to keep the stage where it is, so a rally with no
          // legs cannot have a stage unassigned out from under it.
          ...(routes.length > 0 ? { routeId: payload.routeId } : {}),
          scoreKey: payload.scoreKey,
          timeScoreKey: payload.timeScoreKey,
          merkScoreKey: payload.merkScoreKey,
          timeConfig: payload.timeConfig,
          usesSecondCard: payload.usesSecondCard,
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
          <p className="text-gray-600 mt-2">
            Edit the stage name{routes.length > 0 ? ', its route' : ''} and its answer key.
          </p>
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
              routes={routes}
              endsRoute={position.endsRoute}
              endsRally={position.endsRally}
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
