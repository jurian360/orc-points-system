'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import StandingsPrintView, {
  parsePrintMode,
  type PrintMode,
  type PrintRally,
  type StandingsEntry,
  type StandingsRouteRef,
  type StandingsStage,
} from '../../../../components/StandingsPrintView';

// The standings on paper: `GET /api/rallies/[id]/standings` read onto A4. Which
// sheets there are and how they are laid out is StandingsPrintView's, shared
// with the offline workspace; this page only fetches what it prints.
export default function StandingsPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [rallyId, setRallyId] = useState('');
  const [rally, setRally] = useState<PrintRally | null>(null);
  const [standings, setStandings] = useState<StandingsEntry[]>([]);
  const [stages, setStages] = useState<StandingsStage[]>([]);
  const [routes, setRoutes] = useState<StandingsRouteRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialMode, setInitialMode] = useState<PrintMode | null>(null);

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    resolve();
  }, [params]);

  // Read what the dashboard was showing, before the sheets are first drawn.
  useEffect(() => {
    setInitialMode(parsePrintMode(window.location.search));
  }, []);

  const load = useCallback(async () => {
    if (!rallyId) return;

    try {
      const [rallyRes, standingsRes] = await Promise.all([
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/rallies/${rallyId}/standings`),
      ]);

      if (!rallyRes.ok) throw new Error('Failed to fetch rally');
      setRally(await rallyRes.json());

      if (!standingsRes.ok) throw new Error('Failed to fetch standings');
      const data = await standingsRes.json();
      setStandings(data.standings || []);
      setStages(data.stages || []);
      setRoutes(data.routes || []);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load the standings. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading standings...</p>
      </div>
    );
  }

  if (!rally) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Rally not found'}</p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  return (
    <StandingsPrintView
      rally={rally}
      standings={standings}
      stages={stages}
      routes={routes}
      initialMode={initialMode}
      back={{ href: `/rallies/${rallyId}`, label: `Back to ${rally.name}` }}
      error={error}
    />
  );
}
