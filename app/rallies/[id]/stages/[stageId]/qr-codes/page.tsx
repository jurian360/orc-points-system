'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import ClassificationBadge from '../../../../../components/ClassificationBadge';
import QrCode from '../../../../../components/QrCode';
import { crewLabel, type ClassificationValue } from '../../../../../lib/participants';
import { PAGE_CONTAINER } from '../../../../../lib/pageContainer';

// The printable sheet of QR codes for one stage: one code per participant,
// each standing for that crew's card for this stage.
//
// This is the whole handover between the officials' app and the participants'.
// A crew scans their code, the Android app pulls their card, and when they
// finalise it the letters come back here and are scored like any other sheet.
// So the page is built to be printed and cut up, and everything an official
// needs to fix a code that went astray is on it.

interface CardRow {
  eq: number;
  code: string | null;
  classification: ClassificationValue | string;
  driverName: string;
  navigatorName: string;
  submittedAt: string | null;
  hasSheet: boolean;
}

interface AccessCodes {
  rally: { _id: string; name: string; code: string };
  stage: { _id: string; name: string; cardId: number; cardNumber: number };
  cards: CardRow[];
}

// The prefix the Android app strips from a scanned code — the same constant as
// `CARD_QR_PREFIX` on the server, repeated here because that module is
// server-only.
const QR_PREFIX = 'ADD:';

export default function StageQrCodesPage({
  params,
}: {
  params: Promise<{ id: string; stageId: string }>;
}) {
  const [rallyId, setRallyId] = useState('');
  const [stageId, setStageId] = useState('');
  const [data, setData] = useState<AccessCodes | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the crews that have handed in, or only those that have not — an
  // official reprinting halfway through an event does not want all 56 again.
  const [filter, setFilter] = useState<'all' | 'open' | 'submitted'>('all');

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
      setStageId(resolved.stageId);
    };
    resolve();
  }, [params]);

  const load = useCallback(async () => {
    if (!stageId) return;

    try {
      const response = await fetch(`/api/stages/${stageId}/access-codes`);
      if (!response.ok) throw new Error('Failed to load the codes of this stage');
      setData(await response.json());
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load the codes of this stage. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [stageId]);

  useEffect(() => {
    load();
  }, [load]);

  // Every write goes through the same POST and returns the whole list back, so
  // the page never has to guess what the server did.
  const post = async (body: Record<string, unknown>, failure: string) => {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/stages/${stageId}/access-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || failure);

      setData(payload);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading QR codes...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">
            {error || 'Stage not found'}
          </p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  const withCode = data.cards.filter((card) => card.code);
  const missing = data.cards.length - withCode.length;
  const submitted = data.cards.filter((card) => card.submittedAt).length;

  const visible = data.cards.filter((card) => {
    if (!card.code) return false;
    if (filter === 'open') return !card.submittedAt;
    if (filter === 'submitted') return Boolean(card.submittedAt);
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-100 py-4 print:bg-white print:py-0">
      <div className={`${PAGE_CONTAINER} py-4 print:p-0 print:max-w-none`}>
        {/* Everything in here is for the official at the screen, not for paper */}
        <div className="print:hidden">
          <div className="mb-4">
            <Link
              href={`/rallies/${rallyId}/stages/${stageId}`}
              className="text-blue-600 hover:underline text-base"
            >
              &larr; Back to {data.stage.name}
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">
              QR Codes — {data.stage.name}
            </h1>
            <p className="text-gray-700 text-base">
              One code per participant of <span className="font-semibold">{data.rally.name}</span>.
              A crew scans theirs to pull this stage&apos;s control card into the app; the card
              comes back here when they finalise it. Print this page and cut along the cards.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mb-6">
            <div className="px-6 py-4 border-b-2 border-gray-200 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3">
              <div className="text-base text-gray-700">
                <span className="font-semibold text-gray-900">{withCode.length}</span> of{' '}
                {data.cards.length} participants have a code
                {missing > 0 && (
                  <span className="text-amber-700 font-medium"> — {missing} still without</span>
                )}
                . <span className="font-semibold text-gray-900">{submitted}</span> handed in.
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() =>
                    post({ action: 'generate' }, 'Failed to generate the missing codes')
                  }
                  disabled={busy}
                  className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 font-medium text-base transition-colors disabled:opacity-50"
                >
                  {missing > 0 ? `Generate ${missing} Missing Codes` : 'Generate Codes'}
                </button>
                <button
                  onClick={() => window.print()}
                  disabled={visible.length === 0}
                  className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-base transition-colors disabled:opacity-50"
                >
                  Print
                </button>
              </div>
            </div>

            <div className="px-6 py-3 flex flex-wrap items-center gap-2 text-base">
              <span className="text-gray-700 font-medium mr-1">Show:</span>
              {(
                [
                  ['all', `All (${withCode.length})`],
                  ['open', `Not handed in (${withCode.length - submitted})`],
                  ['submitted', `Handed in (${submitted})`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    filter === value
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {error && (
              <div className="px-6 pb-4">
                <p className="text-red-600 font-medium text-base">{error}</p>
              </div>
            )}

            {data.cards.length === 0 && (
              <div className="px-6 pb-5 text-base text-gray-700">
                This rally has no participants yet. Import the entry list on the{' '}
                <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline">
                  rally dashboard
                </Link>{' '}
                first — a code belongs to a crew, not to an EQ number nobody has claimed.
              </div>
            )}
          </div>
        </div>

        {/* The paper header: which rally and which card these belong to */}
        <div className="hidden print:block mb-3">
          <h1 className="text-lg font-bold">
            {data.rally.name} — {data.stage.name} (card {data.stage.cardNumber})
          </h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 print:grid-cols-3 print:gap-2">
          {visible.map((card) => (
            <div
              key={card.eq}
              className="bg-white rounded-xl shadow border-2 border-gray-300 p-4 flex flex-col items-center print:shadow-none print:rounded-none print:border print:break-inside-avoid"
            >
              <div className="w-full flex items-center justify-between mb-2">
                <span className="text-2xl font-bold text-gray-900">EQ {card.eq}</span>
                <ClassificationBadge classification={card.classification} />
              </div>

              <p className="w-full text-base text-gray-700 mb-2 truncate" title={crewLabel(card)}>
                {crewLabel(card) || <span className="text-gray-400">Crew not recorded</span>}
              </p>

              <QrCode
                value={`${QR_PREFIX}${card.code}`}
                size={180}
                title={`Control card of EQ ${card.eq} for ${data.stage.name}`}
              />

              <p className="mt-2 font-mono text-xl font-bold tracking-widest text-gray-900">
                {card.code}
              </p>
              <p className="text-sm text-gray-600 print:text-black">
                {data.rally.code} &middot; card {data.stage.cardNumber}
              </p>

              {/* Screen-only: the state of this card and how to correct it */}
              <div className="print:hidden w-full mt-3 pt-3 border-t border-gray-200">
                <p className="text-base mb-2">
                  {card.submittedAt ? (
                    <span className="text-green-700 font-medium">
                      Handed in {formatDate(card.submittedAt)}
                    </span>
                  ) : card.hasSheet ? (
                    <span className="text-blue-700 font-medium">Sheet started, not handed in</span>
                  ) : (
                    <span className="text-gray-500">Not handed in</span>
                  )}
                </p>

                <div className="flex flex-wrap gap-2">
                  {card.submittedAt && (
                    <button
                      onClick={() =>
                        post(
                          { action: 'reopen', eq: card.eq },
                          'Failed to reopen this card'
                        )
                      }
                      disabled={busy}
                      className="px-3 py-1.5 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 font-medium text-sm transition-colors disabled:opacity-50"
                      title="Let this crew hand in again on the same code"
                    >
                      Reopen
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Give EQ ${card.eq} a new code? The printed QR they have now stops working.`
                        )
                      ) {
                        return;
                      }
                      post({ action: 'reissue', eq: card.eq }, 'Failed to reissue this code');
                    }}
                    disabled={busy}
                    className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm transition-colors disabled:opacity-50"
                    title="Replace this code — the sheet that carried the old one stops working"
                  >
                    New code
                  </button>
                  <Link
                    href={`/rallies/${rallyId}/participants/${card.eq}`}
                    className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-sm transition-colors"
                  >
                    Card
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>

        {withCode.length > 0 && visible.length === 0 && (
          <p className="print:hidden text-base text-gray-600 mt-4">
            No participant matches this filter.
          </p>
        )}
      </div>
    </div>
  );
}
