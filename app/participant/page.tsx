'use client';

import React, { useEffect, useState } from 'react';
import RiderResultsView from '../components/RiderResultsView';
import { PAGE_CONTAINER } from '../lib/layout';
import type { RiderResults } from '../types';

// A rider's own dashboard: the rallies they have ridden, who they rode each of
// them with, how the crew did, and where their crews stand in each season.
//
// It reads `/api/me/results`, which takes its id from the session and from
// nowhere else — there is no rider id in this page's URL for anybody to change
// into somebody else's. Everything on screen comes from the same module an
// official reads about this rider, so the two cannot disagree.
export default function ParticipantDashboard() {
  const [results, setResults] = useState<RiderResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/me/results');
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setError(data.error || 'Could not load your results.');
          return;
        }

        setResults(data);
      } catch {
        setError('Could not load your results.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className={PAGE_CONTAINER}>
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Your rallies</h1>
        <p className="text-gray-600 text-base mb-6 max-w-3xl">
          Everything you have ridden, who you rode it with, and how your crews stand in each
          season. Your details and your classification are kept by the officials — ask them to
          correct anything that is wrong.
        </p>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-base text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-center text-lg text-gray-600 py-8">Loading your results…</p>
        ) : results ? (
          // No rally links: a rider has no access to the rally pages, so a
          // link from here would only take them to a redirect.
          <RiderResultsView results={results} isSelf linkRallies={false} />
        ) : null}
      </div>
    </div>
  );
}
