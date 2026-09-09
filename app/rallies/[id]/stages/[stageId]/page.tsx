'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import StageKeyCard from '../../../../components/StageKeyCard';
import { useAuth } from '../../../../components/AuthContext';
import type { StageMerkKeyRow, StageScoreKeyRow } from '../../../../components/StageKeyCard';
import type { StageTimeConfig, TimeKeyRow } from '../../../../lib/timeScoring';
import { PAGE_CONTAINER } from '../../../../lib/layout';
import { stageLegPosition, type LegPosition, type RallyRoute } from '../../../../lib/routes';

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
  const { can } = useAuth();
  const [rallyId, setRallyId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [routes, setRoutes] = useState<RallyRoute[]>([]);
  // Where the stage sits in the rally's legs decides what its start and finish
  // rows do — a free start, a finish with or without the break behind it, a
  // finish that disqualifies — and so the maximum the stage can hand out.
  const [position, setPosition] = useState<LegPosition | null>(null);
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

  // Until the stage list has landed the page reads as it always did: a stage
  // that ends its route and the rally, which is what the key card defaults to.
  const endsRoute = position ? position.endsRoute : true;
  const endsRally = position ? position.endsRally : true;
  const routeIndex = position
    ? routes.findIndex((route) => route._id === position.routeId)
    : -1;
  const route = routeIndex >= 0 ? routes[routeIndex] : null;
  const routePosition = routeIndex + 1;

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
      <div className={`${PAGE_CONTAINER} py-4`}>
        <div className="mb-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">{stage.name}</h1>
            {/* The leg this stage is ridden in, shown the way the rally code is
                on the dashboard: only when there is one. */}
            {route && (
              <span
                className="text-base font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5"
                title="The route this stage is ridden in"
              >
                Route {routePosition}: {route.name}
              </span>
            )}
          </div>
          <p className="text-gray-700 text-base">
            Answer key of this stage, laid out as the controlekaart. Created:{' '}
            {formatDate(stage.createdAt)}
            {endsRally
              ? ' — last stage of the rally.'
              : endsRoute
                ? ' — last stage of its route.'
                : ''}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200 mb-6">
          <div className="px-6 py-3 border-b-2 border-gray-200 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <h2 className="text-lg font-bold text-gray-800">Answer Key</h2>
            {/* Reading the key is every official's — a data-entry account types
                cards against it. Changing it, printing the QR codes and
                importing a control's times are an admin's. */}
            {can('manage:rally') && (
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
            )}
          </div>

          {/* Same 4 columns as the stage form and the scored sheets */}
          <StageKeyCard
            scoreKey={stage.scoreKey}
            timeScoreKey={stage.timeScoreKey}
            merkScoreKey={stage.merkScoreKey}
            timeConfig={stage.timeConfig}
            startsRoute={position ? position.startsRoute : true}
            endsRoute={endsRoute}
            endsRally={endsRally}
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
