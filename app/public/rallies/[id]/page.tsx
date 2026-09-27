'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import ClassificationBadge from '../../../components/ClassificationBadge';
import { isRanked, STATUS_LABEL, STATUS_TITLE, type StandingsStatus } from '../../../lib/standings';
import { CLASSIFICATIONS, type ClassificationValue } from '../../../lib/participants';

// The public results page: what an admin turns on per rally
// (/rallies/[id]/public-results) so anyone with the link — or the QR code
// printed from that page — can read the standings with no account. It is the
// screen counterpart of the Algemeen klassement sheet on
// /rallies/[id]/standings/print: the whole field, one table, ranked the same
// way, filterable by classification, with the same four numbers per stage a
// printed result sheet shows (ORC's, Tijd, Diversen, that stage's own total)
// on a rally of more than one. What it deliberately does not show is any one
// crew's answer sheet — the letters, the WPT's, the merk column — only the
// totals those sheets add up into, which is all
// `GET /api/public/rallies/[id]/results` ever returns.
//
// No session, no app nav (ClientLayout skips it for every /public/ path) —
// this is the one page in the app built to be opened by someone who has never
// signed in and never will.
//
// Unlike the print page, this does not group the per-stage columns by route
// on a rally ridden in legs — the stages are shown in running order either
// way, which is what a phone screen has room for.

interface PublicStage {
  _id: string;
  name: string;
}

// What a stage cost this crew — the same four numbers as the rally total,
// scaled down to one stage — or what a blank card costs on it when they have
// no sheet for it (`missingSheet`), never the sheet's own rows.
interface PublicStageScore {
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  missingSheet?: boolean;
}

interface PublicStandingsEntry {
  eq: number;
  classification: ClassificationValue | '';
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  status: StandingsStatus;
  rank: number;
  stagePenalties: Record<string, PublicStageScore>;
}

interface PublicResults {
  rally: { name: string; code?: string };
  totalStages: number;
  stages: PublicStage[];
  standings: PublicStandingsEntry[];
}

export default function PublicRallyResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [rallyId, setRallyId] = useState('');
  const [data, setData] = useState<PublicResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState('');

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    resolve();
  }, [params]);

  const load = useCallback(async () => {
    if (!rallyId) return;

    try {
      const response = await fetch(`/api/public/rallies/${encodeURIComponent(rallyId)}/results`);
      // A rally that does not exist and one whose public page is off answer
      // the same 404 — see the API route — so this reads the same either way.
      if (!response.ok) {
        setError(
          response.status === 404
            ? 'These results are not available. The rally may not have a public results page, or it may have been turned off.'
            : 'Could not load these results. Please try again later.'
        );
        setData(null);
        return;
      }
      setData(await response.json());
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Could not load these results. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleStandings = useMemo(() => {
    if (!data) return [];
    if (!classFilter) return data.standings;
    return data.standings.filter((entry) => (entry.classification || '') === classFilter);
  }, [data, classFilter]);

  // A rally of one stage scores the same numbers twice — the stage total *is*
  // the rally total — so the per-stage columns only earn their room once
  // there is more than one stage to tell apart, the same rule the print sheet
  // follows.
  const showStages = Boolean(data && data.totalStages > 1);
  const stages = data?.stages ?? [];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-lg font-semibold text-gray-700">Loading results…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-lg font-semibold text-red-600 text-center max-w-md">
          {error || 'Rally not found'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-600 shadow-md">
        <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-5">
          <div className="flex items-center gap-2.5 text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/sark-logo.png"
              alt="SARK Points System"
              className="h-9 w-9 rounded-full shadow-sm flex-shrink-0"
            />
            <span className="text-sm font-medium text-blue-100">SARK Points System</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mt-2 truncate">
            {data.rally.name}
          </h1>
          {data.rally.code && (
            <p className="font-mono text-sm text-blue-100 tracking-wider mt-0.5">
              {data.rally.code}
            </p>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 py-6">
        <p className="text-gray-600 text-sm mb-4">
          Total penalty points (ORC&apos;s + Tijd + Diversen) over every stage — lowest wins. A
          crew with no card for the last stage, or outside its finish window, is a DNF; a crew
          with no card at all is a DNS. Both are listed behind the field.
          {showStages && ' Scroll the table sideways for the numbers per stage.'}
        </p>

        <div className="flex items-center gap-2 mb-4">
          <label htmlFor="class-filter" className="text-sm font-medium text-gray-700">
            Classification:
          </label>
          <select
            id="class-filter"
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All classes</option>
            {CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>
                Class {value}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          {visibleStandings.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-600">
                {data.standings.length === 0
                  ? 'No results yet.'
                  : 'No crew matches this classification.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  {showStages ? (
                    <>
                      <tr>
                        <th
                          rowSpan={2}
                          className="px-3 py-2.5 text-left align-bottom text-xs font-semibold text-gray-700 uppercase tracking-wider"
                        >
                          #
                        </th>
                        <th
                          rowSpan={2}
                          className="px-3 py-2.5 text-left align-bottom text-xs font-semibold text-gray-700 uppercase tracking-wider"
                        >
                          EQ
                        </th>
                        <th
                          rowSpan={2}
                          className="px-3 py-2.5 text-left align-bottom text-xs font-semibold text-gray-700 uppercase tracking-wider"
                        >
                          Class
                        </th>
                        <th
                          rowSpan={2}
                          className="px-3 py-2.5 text-left align-bottom text-xs font-semibold text-gray-700 uppercase tracking-wider"
                        >
                          Navigator
                        </th>
                        <th
                          rowSpan={2}
                          className="px-3 py-2.5 text-left align-bottom text-xs font-semibold text-gray-700 uppercase tracking-wider"
                        >
                          Bestuurder
                        </th>
                        {stages.map((stage) => (
                          <th
                            key={stage._id}
                            colSpan={4}
                            className="px-2 py-1.5 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-l border-gray-300 whitespace-nowrap"
                          >
                            {stage.name}
                          </th>
                        ))}
                        <th
                          colSpan={4}
                          className="px-2 py-1.5 text-center text-xs font-bold text-gray-800 uppercase tracking-wider border-l-2 border-gray-400"
                        >
                          Rally Total
                        </th>
                      </tr>
                      <tr>
                        {stages.map((stage) => (
                          <React.Fragment key={stage._id}>
                            <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-gray-600 uppercase border-l border-gray-300">
                              ORC
                            </th>
                            <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-gray-600 uppercase">
                              Tijd
                            </th>
                            <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-gray-600 uppercase">
                              Div.
                            </th>
                            <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-gray-600 uppercase">
                              Sub
                            </th>
                          </React.Fragment>
                        ))}
                        <th className="px-1.5 py-1.5 text-right text-[10px] font-bold text-gray-700 uppercase border-l-2 border-gray-400">
                          ORC&apos;s
                        </th>
                        <th className="px-1.5 py-1.5 text-right text-[10px] font-bold text-gray-700 uppercase">
                          Tijd
                        </th>
                        <th className="px-1.5 py-1.5 text-right text-[10px] font-bold text-gray-700 uppercase">
                          Div.
                        </th>
                        <th className="px-1.5 py-1.5 text-right text-[10px] font-bold text-gray-700 uppercase">
                          Totaal
                        </th>
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        #
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        EQ
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Class
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Navigator
                      </th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Bestuurder
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        ORC&apos;s
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Tijd
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Div.
                      </th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Totaal
                      </th>
                    </tr>
                  )}
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {visibleStandings.map((entry) => (
                    <tr
                      key={entry.eq}
                      className={
                        entry.status === 'dns'
                          ? 'bg-gray-100'
                          : entry.status === 'dnf'
                            ? 'bg-red-50'
                            : entry.rank === 1
                              ? 'bg-yellow-50'
                              : undefined
                      }
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {isRanked(entry.status) ? (
                          <span className="text-sm font-bold text-gray-900">
                            {entry.rank}
                            {entry.rank === 1 && (
                              <span className="ml-1" title="Winner">
                                🏆
                              </span>
                            )}
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-bold ${
                              entry.status === 'dns'
                                ? 'bg-gray-200 text-gray-700'
                                : 'bg-red-100 text-red-800'
                            }`}
                            title={STATUS_TITLE[entry.status]}
                          >
                            {STATUS_LABEL[entry.status]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm font-bold text-gray-900">
                        {entry.eq}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <ClassificationBadge classification={entry.classification} />
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-800 whitespace-nowrap">
                        {entry.navigatorName || '—'}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-800 whitespace-nowrap">
                        {entry.driverName || '—'}
                      </td>
                      {showStages &&
                        stages.map((stage) => {
                          // No sheet for this stage is not a zero: the
                          // standings score it as a blank card, so the * says
                          // where the number came from — the same footnote the
                          // print sheet carries.
                          const score = entry.stagePenalties[stage._id];
                          const cell = 'px-1.5 py-2 whitespace-nowrap text-xs text-right tabular-nums text-gray-700';

                          return (
                            <React.Fragment key={stage._id}>
                              <td className={`${cell} border-l border-gray-200`}>
                                {score ? score.orcPenalty : ''}
                              </td>
                              <td className={cell}>{score ? score.timePenalty : ''}</td>
                              <td className={cell}>{score ? score.merkPenalty : ''}</td>
                              <td className={`${cell} font-semibold text-gray-900`}>
                                {score ? (
                                  <>
                                    {score.totalPenalty}
                                    {score.missingSheet ? '*' : ''}
                                  </>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                            </React.Fragment>
                          );
                        })}
                      <td
                        className={`px-3 py-2 whitespace-nowrap text-sm text-right tabular-nums text-gray-800${
                          showStages ? ' border-l-2 border-gray-300' : ''
                        }`}
                      >
                        {entry.orcPenalty}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-right tabular-nums text-gray-800">
                        {entry.timePenalty}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-right tabular-nums text-gray-800">
                        {entry.merkPenalty}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-right font-bold tabular-nums text-gray-900">
                        {entry.totalPenalty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {showStages &&
          visibleStandings.some((entry) =>
            stages.some((stage) => entry.stagePenalties[stage._id]?.missingSheet)
          ) && (
            <p className="text-xs text-gray-500 mt-2">
              * No card handed in for that stage — counted as a blank card.
            </p>
          )}

        <p className="text-center text-xs text-gray-400 mt-6 pb-6">SARK Points System</p>
      </div>
    </div>
  );
}
