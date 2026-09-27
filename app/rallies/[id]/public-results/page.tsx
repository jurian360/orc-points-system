'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import QrCode from '../../../components/QrCode';
import { PAGE_CONTAINER } from '../../../lib/pageContainer';

// Turn a rally's public results page on or off, and print the QR code that
// points at it — one code for the whole rally, unlike the per-participant
// sheet at .../stages/[stageId]/qr-codes.
//
// The page needing an official's own browser location (`window.location`)
// rather than a server-known base URL is deliberate: whoever is printing this
// is signed in as an admin on the app's real address already, so that address
// is the correct one — no environment variable to configure, unlike the
// forgot-password email link, which is built with no browser to ask
// (app/lib/email.ts).

interface Rally {
  _id: string;
  name: string;
  code?: string;
  publicResultsEnabled?: boolean;
}

export default function PublicResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [rallyId, setRallyId] = useState('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filled in once this runs in a browser — see the note above on why this is
  // not read from an env var here.
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    resolve();
  }, [params]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    if (!rallyId) return;

    try {
      const response = await fetch(`/api/rallies/${rallyId}`);
      if (!response.ok) throw new Error('Failed to load this rally');
      setRally(await response.json());
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load this rally. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/rallies/${rallyId}/public-results`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to change this setting');

      setRally((current) => (current ? { ...current, publicResultsEnabled: enabled } : current));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to change this setting');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading...</p>
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

  const publicUrl = origin ? `${origin}/public/rallies/${rallyId}` : '';
  const enabled = Boolean(rally.publicResultsEnabled);

  return (
    <div className="min-h-screen bg-gray-100 py-4 print:bg-white print:py-0">
      {/* Everything in here is for the official at the screen, not for paper */}
      <div className={`${PAGE_CONTAINER} py-4 print:hidden`}>
        <div className="mb-4">
          <Link
            href={`/rallies/${rallyId}`}
            className="text-blue-600 hover:underline text-base"
          >
            &larr; Back to {rally.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">Public Results Page</h1>
          <p className="text-gray-700 text-base">
            A results page anyone can read with no account: the standings of{' '}
            <span className="font-semibold">{rally.name}</span> — every crew&apos;s total, no
            answer sheets — filterable by classification. Off by default; turning it on does not
            change what an official sees anywhere else in the app.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mb-6 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-gray-900">
                {enabled ? 'Public results page is on' : 'Public results page is off'}
              </p>
              <p className="text-base text-gray-600 mt-1">
                {enabled
                  ? 'Anyone with the link or the QR code below can read the current standings.'
                  : 'The results of this rally are not reachable without signing in.'}
              </p>
            </div>
            <button
              onClick={() => toggle(!enabled)}
              disabled={saving}
              className={`px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 ${
                enabled
                  ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {saving ? 'Saving…' : enabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>

          {error && <p className="text-red-600 font-medium text-base mt-4">{error}</p>}

          {enabled && (
            <div className="mt-6 pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <QrCode
                value={publicUrl || rallyId}
                size={160}
                title={`Public results of ${rally.name}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-500 mb-1">Link</p>
                <p className="font-mono text-sm break-all text-gray-900 mb-3">
                  {publicUrl || 'Loading…'}
                </p>
                <div className="flex flex-wrap gap-3">
                  {publicUrl && (
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-base transition-colors"
                    >
                      Open public page
                    </a>
                  )}
                  <button
                    onClick={() => window.print()}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-base transition-colors"
                  >
                    Print A4 sheet
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The printable sheet: one QR code, large, with the rally name and the
          link underneath for anyone whose camera will not focus. */}
      {enabled && (
        <div className="hidden print:flex print:flex-col print:items-center print:justify-center print:pt-24">
          <h1 className="text-2xl font-bold mb-1">{rally.name}</h1>
          {rally.code && <p className="text-base text-gray-700 mb-6">{rally.code}</p>}
          <QrCode value={publicUrl || rallyId} size={320} title={`Public results of ${rally.name}`} />
          <p className="mt-6 text-lg font-semibold">Scan for the results</p>
          <p className="mt-1 font-mono text-sm text-gray-700 break-all max-w-md text-center">
            {publicUrl}
          </p>
        </div>
      )}
    </div>
  );
}
