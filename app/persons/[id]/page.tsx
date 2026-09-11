'use client';

import React, { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ClassificationBadge from '../../components/ClassificationBadge';
import RiderResultsView from '../../components/RiderResultsView';
import { useAuth } from '../../components/AuthContext';
import { PAGE_CONTAINER } from '../../lib/layout';
import { CLASSIFICATIONS } from '../../lib/participants';
import type { RiderResults } from '../../types';

// One rider, as an official reads them: their details, everything they have
// ridden and with whom, and their classification with its whole history.
//
// This is the classification admin's working page. The class control at the
// top is the only thing that role can change anywhere in the app, and it sits
// here rather than in a form of its own because it is read against the results
// underneath it — a rider is moved up because of what they have been doing.
export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const mayClassify = can('manage:classifications');

  const [results, setResults] = useState<RiderResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/persons/${id}/results`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || 'Could not load this rider.');
        return;
      }

      setResults(data);
    } catch {
      setError('Could not load this rider.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Changing the class re-reads the whole page rather than patching the rider
  // in place: it can move their crews between the overall standings shown
  // below, and a page half-refreshed would contradict itself.
  const handleClassification = async (classification: string) => {
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/persons/${id}/classification`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classification }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not change the classification');

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the classification.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className={PAGE_CONTAINER}>
        <Link href="/persons" className="text-blue-600 hover:underline text-base">
          ← All riders
        </Link>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-base text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <p className="mt-8 text-center text-lg text-gray-600">Loading rider…</p>
        ) : !results ? (
          <p className="mt-8 text-center text-lg text-gray-600">This rider was not found.</p>
        ) : (
          <div className="mt-4 space-y-6">
            {mayClassify && (
              <section className="bg-white rounded-xl shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Classification</h2>
                <p className="text-gray-600 text-base mb-3 max-w-3xl">
                  The class this rider rides in. A crew&apos;s class is the higher of its two
                  riders&apos; (B &lt; A &lt; H), so changing this moves every crew they are
                  half of. Rallies already ridden keep the class they were ridden under;
                  entries for rallies still to come follow the change.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <ClassificationBadge
                    classification={results.person.classification}
                    fallback="No class yet"
                  />
                  <select
                    value={results.person.classification}
                    disabled={saving}
                    onChange={(e) => handleClassification(e.target.value)}
                    aria-label="Classification"
                    className="p-2 border-2 border-gray-300 rounded-lg text-base text-gray-700 disabled:opacity-60"
                  >
                    <option value="">— none —</option>
                    {CLASSIFICATIONS.map((letter) => (
                      <option key={letter} value={letter}>
                        {letter}
                      </option>
                    ))}
                  </select>
                  {saving && <span className="text-base text-gray-500">Saving…</span>}
                </div>
              </section>
            )}

            <RiderResultsView results={results} />
          </div>
        )}
      </div>
    </div>
  );
}
