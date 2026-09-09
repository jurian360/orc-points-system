'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StageForm, { type StageFormPayload } from '../../../../components/StageForm';
import { PAGE_CONTAINER } from '../../../../lib/layout';
import type { RallyRoute } from '../../../../lib/routes';

export default function NewStagePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState<string>('');
  // The rally's legs. Empty on a rally with no routes, and then the form shows
  // no route field — but a rally that *has* them needs one, so the form cannot
  // be given a stage to save without knowing them.
  const [routes, setRoutes] = useState<RallyRoute[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    getParams();
  }, [params]);

  useEffect(() => {
    if (!rallyId) return;

    const loadRoutes = async () => {
      try {
        const response = await fetch(`/api/rallies/${rallyId}/routes`);
        if (!response.ok) return;
        const data = await response.json();
        setRoutes(data.routes || []);
      } catch (err) {
        console.error(err);
      }
    };
    loadRoutes();
  }, [rallyId]);

  const handleSubmit = async (payload: StageFormPayload) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/stages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rallyId,
          name: payload.name,
          routeId: payload.routeId,
          scoreKey: payload.scoreKey,
          timeScoreKey: payload.timeScoreKey,
          merkScoreKey: payload.merkScoreKey,
          timeConfig: payload.timeConfig,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create stage');
      }

      router.push(`/rallies/${rallyId}`);
    } catch (err) {
      setError('Failed to create stage. Please try again.');
      console.error(err);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className={`${PAGE_CONTAINER} py-4`}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Add Stage</h1>
          <p className="text-gray-600 mt-2">
            Enter the stage name and its answer key
            {routes.length > 0 ? ', and the route it is ridden in' : ''}.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          {/* No `endsRoute`/`endsRally`: a new stage is created at the end of
              its route, which is what both default to. */}
          <StageForm onSubmit={handleSubmit} routes={routes} />
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
            <p className="text-lg">Creating stage...</p>
          </div>
        </div>
      )}
    </div>
  );
}
