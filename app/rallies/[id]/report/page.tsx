'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import ClassificationBadge from '../../../components/ClassificationBadge';
import { crewLabel } from '../../../lib/participants';
import { PAGE_CONTAINER } from '../../../lib/pageContainer';
import type { RowReport, RowReportEntry } from '../../../types';

// The row report: how the field answered one ORC row of one stage.
//
// Officials open it when a row looks wrong — a key with a typo, or a question
// the whole field read the same way — and need to see how many crews were
// charged on it, which answers were given most and what every crew wrote,
// without opening every card. Everything on it comes from
// GET /api/stages/[id]/row-report, which scores the row with the same function
// the cards use. The stage and the row are kept in the address
// (?stageId=…&row=…) so a report can be linked to and reloaded.

// One card holds 30 ORC rows; a stage with a second card has 60.
const ORC_ROWS_PER_CARD = 30;

interface StageOption {
  _id: string;
  name: string;
  usesSecondCard?: boolean;
  scoreKey?: { rowNumber: number; answers?: string[] }[];
}

type EntryFilter = 'all' | 'penalty' | 'noPenalty';

const STATUS_TEXT: Record<RowReportEntry['status'], string> = {
  answered: '',
  blank: 'left blank',
  untyped: 'card not typed yet',
  noSheet: 'no card',
};

function rowCountOf(stage: StageOption | undefined): number {
  return stage?.usesSecondCard ? ORC_ROWS_PER_CARD * 2 : ORC_ROWS_PER_CARD;
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function Letters({ letters, empty = '(blank)' }: { letters: string[]; empty?: string }) {
  const given = letters.filter(Boolean);
  if (given.length === 0) return <span className="text-gray-400 italic">{empty}</span>;
  return (
    <span className="inline-flex gap-1">
      {given.map((letter, index) => (
        <span
          key={index}
          className="inline-flex items-center justify-center w-7 h-7 rounded border border-gray-300 bg-white font-mono font-bold text-gray-900"
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

function RowReportContent({ rallyId }: { rallyId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rallyName, setRallyName] = useState('');
  const [stages, setStages] = useState<StageOption[]>([]);
  const [loadingStages, setLoadingStages] = useState(true);
  const [report, setReport] = useState<RowReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EntryFilter>('all');

  const stageId = searchParams.get('stageId') || '';
  const rowParam = Number(searchParams.get('row'));
  const stage = stages.find((option) => option._id === stageId);
  const rowCount = rowCountOf(stage);
  const rowNumber =
    Number.isInteger(rowParam) && rowParam >= 1 && rowParam <= rowCount ? rowParam : 1;

  const select = useCallback(
    (nextStageId: string, nextRow: number) => {
      const query = new URLSearchParams();
      if (nextStageId) query.set('stageId', nextStageId);
      query.set('row', String(nextRow));
      router.replace(`${pathname}?${query.toString()}`, { scroll: false });
    },
    [pathname, router]
  );

  useEffect(() => {
    const load = async () => {
      try {
        const [rallyRes, stagesRes] = await Promise.all([
          fetch(`/api/rallies/${rallyId}`),
          fetch(`/api/stages?rallyId=${rallyId}`),
        ]);
        if (!rallyRes.ok) throw new Error('Failed to fetch rally');
        setRallyName((await rallyRes.json()).name || '');
        if (stagesRes.ok) setStages(await stagesRes.json());
      } catch (err) {
        console.error(err);
        setError('Failed to load rally. Please try again later.');
      } finally {
        setLoadingStages(false);
      }
    };
    load();
  }, [rallyId]);

  // Without a stage in the address, open on the first stage of the rally.
  useEffect(() => {
    if (loadingStages || stages.length === 0) return;
    if (!stage) select(stages[0]._id, 1);
  }, [loadingStages, stages, stage, select]);

  useEffect(() => {
    if (!stage) return;
    let cancelled = false;
    const load = async () => {
      setLoadingReport(true);
      setError(null);
      try {
        const res = await fetch(`/api/stages/${stage._id}/row-report?row=${rowNumber}`);
        if (!res.ok) throw new Error('Failed to fetch report');
        const data: RowReport = await res.json();
        if (!cancelled) setReport(data);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setReport(null);
          setError('Failed to load the report. Please try again later.');
        }
      } finally {
        if (!cancelled) setLoadingReport(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [stage, rowNumber]);

  const visibleEntries = useMemo(() => {
    if (!report) return [];
    if (filter === 'penalty') return report.entries.filter((entry) => entry.penalty > 0);
    if (filter === 'noPenalty') return report.entries.filter((entry) => entry.penalty === 0);
    return report.entries;
  }, [report, filter]);

  const rowOptions = useMemo(() => {
    const keyByRow = new Map((stage?.scoreKey || []).map((row) => [row.rowNumber, row]));
    return Array.from({ length: rowCount }, (_, index) => {
      const number = index + 1;
      const letters = (keyByRow.get(number)?.answers || []).filter(Boolean);
      return {
        number,
        label: `Row ${number}${letters.length > 0 ? ` — ${letters.join(' ')}` : ' — not used'}`,
      };
    });
  }, [stage, rowCount]);

  if (loadingStages) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading...</p>
      </div>
    );
  }

  const summary = report?.summary;
  const keyIsEmpty = report ? report.key.answers.length === 0 : false;

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className={`${PAGE_CONTAINER} py-4`}>
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Row Report</h1>
          <p className="text-gray-700 text-base">
            <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline font-medium">
              {rallyName || 'Rally'}
            </Link>{' '}
            — how the crews answered one ORC row of a stage.
          </p>
        </div>

        {stages.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-6 text-gray-700">
            This rally has no stages yet.
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl shadow p-4 mb-6 flex flex-wrap items-end gap-4">
              <label className="flex flex-col text-sm font-medium text-gray-700">
                Stage
                <select
                  value={stage?._id || ''}
                  onChange={(event) => select(event.target.value, 1)}
                  className="mt-1 border border-gray-300 rounded-md px-3 py-2 text-base text-gray-900 min-w-56"
                >
                  {stages.map((option, index) => (
                    <option key={option._id} value={option._id}>
                      {index + 1}. {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-sm font-medium text-gray-700">
                Row
                <select
                  value={rowNumber}
                  onChange={(event) => select(stageId, Number(event.target.value))}
                  className="mt-1 border border-gray-300 rounded-md px-3 py-2 text-base text-gray-900 min-w-48"
                >
                  {rowOptions.map((option) => (
                    <option key={option.number} value={option.number}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => select(stageId, rowNumber - 1)}
                  disabled={rowNumber <= 1}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300 disabled:opacity-50"
                >
                  &larr; Previous row
                </button>
                <button
                  onClick={() => select(stageId, rowNumber + 1)}
                  disabled={rowNumber >= rowCount}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300 disabled:opacity-50"
                >
                  Next row &rarr;
                </button>
              </div>
              {loadingReport && <span className="text-gray-500 text-sm py-2">Loading…</span>}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6">
                {error}
              </div>
            )}

            {report && (
              <>
                {/* The key of the row, so the answers below can be read against it. */}
                <div className="bg-white rounded-xl shadow p-4 mb-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-3">
                    {report.stage.name} — row {report.rowNumber}
                  </h2>
                  {keyIsEmpty ? (
                    <p className="text-gray-600">
                      The key of this stage has no letters on this row, so it is not scored.
                    </p>
                  ) : (
                    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-base">
                      <div>
                        <dt className="text-sm text-gray-500">Correct answer</dt>
                        <dd className="mt-1 flex flex-wrap items-center gap-2">
                          <Letters letters={report.key.answers} />
                          {report.key.alternativeAnswers.map((variant, index) => (
                            <span key={index} className="inline-flex items-center gap-2">
                              <span className="text-sm text-gray-500">of</span>
                              <Letters letters={variant} />
                            </span>
                          ))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sm text-gray-500">Ruled out</dt>
                        <dd className="mt-1">
                          <Letters letters={report.key.falseAnswers} empty="none" />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sm text-gray-500">Order counts</dt>
                        <dd className="mt-1 font-medium text-gray-900">
                          {report.key.orderMatters ? 'Yes (1→2)' : 'No'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sm text-gray-500">Maximum</dt>
                        <dd className="mt-1 font-medium text-gray-900">
                          {report.key.maxPenalty > 0 ? report.key.maxPenalty : 'no cap'}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>

                {summary && (
                  <div className="mb-6">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="bg-white rounded-xl shadow p-4">
                        <div className="text-sm text-gray-500">Cards typed</div>
                        <div className="text-3xl font-bold text-gray-900">{summary.typedCards}</div>
                      </div>
                      <div className="bg-white rounded-xl shadow p-4 border-l-4 border-red-400">
                        <div className="text-sm text-gray-500">With penalty points</div>
                        <div className="text-3xl font-bold text-red-700">
                          {summary.withPenalty}
                          <span className="text-base font-medium text-gray-500 ml-2">
                            {percent(summary.withPenalty, summary.typedCards)}
                          </span>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl shadow p-4 border-l-4 border-green-400">
                        <div className="text-sm text-gray-500">Without penalty points</div>
                        <div className="text-3xl font-bold text-green-700">
                          {summary.withoutPenalty}
                          <span className="text-base font-medium text-gray-500 ml-2">
                            {percent(summary.withoutPenalty, summary.typedCards)}
                          </span>
                        </div>
                      </div>
                      <div className="bg-white rounded-xl shadow p-4">
                        <div className="text-sm text-gray-500">Left blank</div>
                        <div className="text-3xl font-bold text-gray-900">{summary.blank}</div>
                      </div>
                      <div className="bg-white rounded-xl shadow p-4">
                        <div className="text-sm text-gray-500">Strafpunten on this row</div>
                        <div className="text-3xl font-bold text-gray-900">{summary.totalPenalty}</div>
                      </div>
                    </div>
                    {(summary.untyped > 0 || summary.noSheet > 0) && (
                      <p className="mt-3 text-sm text-gray-600">
                        Not counted above:{' '}
                        {[
                          summary.untyped > 0 &&
                            `${summary.untyped} ${summary.untyped === 1 ? 'card' : 'cards'} not typed yet`,
                          summary.noSheet > 0 &&
                            `${summary.noSheet} ${summary.noSheet === 1 ? 'crew' : 'crews'} with no card for this stage`,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        . The standings charge them the blank row.
                      </p>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-xl shadow overflow-hidden mb-6">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-800">Most given answers</h2>
                  </div>
                  {report.answers.length === 0 ? (
                    <p className="p-4 text-gray-600">No typed cards for this stage yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Answer</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-600">Crews</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-600">Share</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-600">Strafp.</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">EQ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {report.answers.map((group) => (
                            <tr
                              key={group.letters.join(' ') || '(blank)'}
                              className={group.penalty === 0 ? 'bg-green-50' : undefined}
                            >
                              <td className="px-4 py-2">
                                <Letters letters={group.letters} />
                                {group.orderError && (
                                  <span className="ml-2 text-xs font-semibold text-amber-700">order</span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right font-semibold text-gray-900">{group.count}</td>
                              <td className="px-4 py-2 text-right text-gray-700">
                                {percent(group.count, summary?.typedCards || 0)}
                              </td>
                              <td
                                className={`px-4 py-2 text-right font-semibold ${
                                  group.penalty > 0 ? 'text-red-700' : 'text-green-700'
                                }`}
                              >
                                {group.penalty}
                              </td>
                              <td className="px-4 py-2 text-sm text-gray-700">{group.eqs.join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-xl shadow overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-bold text-gray-800">Answers per crew</h2>
                    <div className="flex gap-1">
                      {(
                        [
                          ['all', 'All'],
                          ['penalty', 'With penalty'],
                          ['noPenalty', 'Without penalty'],
                        ] as [EntryFilter, string][]
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setFilter(value)}
                          className={`px-3 py-1 rounded-md text-sm font-medium border ${
                            filter === value
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {visibleEntries.length === 0 ? (
                    <p className="p-4 text-gray-600">No crews to show.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">EQ</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Kl.</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Crew</th>
                            <th className="px-4 py-2 text-left text-sm font-semibold text-gray-600">Answer</th>
                            <th className="px-4 py-2 text-right text-sm font-semibold text-gray-600">Strafp.</th>
                            <th className="px-4 py-2" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {visibleEntries.map((entry) => {
                            const typed = entry.status === 'answered' || entry.status === 'blank';
                            return (
                              <tr key={entry.eq} className={typed ? undefined : 'text-gray-400'}>
                                <td className="px-4 py-2 font-semibold">
                                  <Link
                                    href={`/rallies/${rallyId}/participants/${entry.eq}`}
                                    className="text-blue-600 hover:underline"
                                  >
                                    {entry.eq}
                                  </Link>
                                </td>
                                <td className="px-4 py-2">
                                  <ClassificationBadge classification={entry.classification} />
                                </td>
                                <td className="px-4 py-2 text-gray-700">{crewLabel(entry) || '—'}</td>
                                <td className="px-4 py-2">
                                  {entry.status === 'answered' ? (
                                    <>
                                      <Letters letters={entry.selectedAnswers} />
                                      {entry.orderError && (
                                        <span className="ml-2 text-xs font-semibold text-amber-700">order</span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="italic text-gray-400">{STATUS_TEXT[entry.status]}</span>
                                  )}
                                </td>
                                <td
                                  className={`px-4 py-2 text-right font-semibold ${
                                    entry.penalty > 0 ? (typed ? 'text-red-700' : 'text-red-300') : 'text-green-700'
                                  }`}
                                >
                                  {entry.penalty}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  {entry.sheetId && (
                                    <Link
                                      href={`/rallies/${rallyId}/answer-sheets/${entry.sheetId}`}
                                      className="text-blue-600 hover:underline text-sm font-medium"
                                    >
                                      Card
                                    </Link>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        <div className="mt-8">
          <Link
            href={`/rallies/${rallyId}`}
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            &larr; Back to Rally
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function RowReportPage({ params }: { params: Promise<{ id: string }> }) {
  const [rallyId, setRallyId] = useState('');

  useEffect(() => {
    params.then((resolved) => setRallyId(resolved.id));
  }, [params]);

  if (!rallyId) return null;

  // `useSearchParams` needs a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
          <p className="text-lg font-semibold">Loading...</p>
        </div>
      }
    >
      <RowReportContent rallyId={rallyId} />
    </Suspense>
  );
}
