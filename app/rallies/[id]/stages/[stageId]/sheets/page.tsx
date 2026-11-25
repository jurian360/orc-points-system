'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import ClassificationBadge from '../../../../../components/ClassificationBadge';
import { PAGE_CONTAINER } from '../../../../../lib/pageContainer';
import type { ClassificationValue } from '../../../../../lib/participants';

// The answer sheets of one stage: every crew of the entry list in EQ order,
// with what this stage's card holds for them — typed, only the times a control
// imported, or nothing yet — and the points it scored. It is where an official
// goes to find one crew's card of one traject, to see which cards are still to
// be typed, and to open, correct or start any of them.
//
// It scores nothing: the numbers are the ones stored on each sheet
// (`totalPenalty`, `timePenalty`, `merkPenalty`, written by app/lib/rescore.ts),
// the ORC's part being the total minus the other two, the same reading the
// standings make. A crew with no sheet shows none — the blank card the
// standings charge them is on the standings and on their own card page.
//
// Reading it is every official's, and so is opening and typing a card, so the
// page is not in `RESTRICTED_PAGES`.

interface Rally {
  _id: string;
  name: string;
  code?: string;
}

interface Stage {
  _id: string;
  name: string;
  routeId?: string | null;
}

interface Route {
  _id: string;
  name: string;
}

interface Participant {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

interface Sheet {
  _id: string;
  eq: number;
  answers?: { selectedAnswers?: string[] }[];
  merkScores?: { merk?: string }[];
  timePenalties?: { wpt?: string }[];
  totalPenalty?: number;
  timePenalty?: number;
  merkPenalty?: number;
  disqualified?: boolean;
}

// What this stage's card holds for one crew.
type CardState = 'typed' | 'times' | 'none';

const STATE_LABEL: Record<CardState, string> = {
  typed: 'Typed',
  times: 'Times only',
  none: 'No card',
};

const STATE_STYLE: Record<CardState, string> = {
  typed: 'bg-green-100 text-green-800',
  times: 'bg-amber-100 text-amber-800',
  none: 'bg-gray-100 text-gray-600',
};

// A sheet holds a typed card once any ORC or merk letter is on it. One with
// only WPT's is the sheet a time import opened before anybody typed the card.
const cardState = (sheet: Sheet | undefined): CardState => {
  if (!sheet) return 'none';
  const letters =
    (sheet.answers || []).some((row) => (row.selectedAnswers || []).some((l) => l && l.trim())) ||
    (sheet.merkScores || []).some((row) => row.merk && row.merk.trim());
  return letters ? 'typed' : 'times';
};

type Filter = 'all' | CardState;

interface Row {
  eq: number;
  participant?: Participant;
  sheet?: Sheet;
  state: CardState;
}

export default function StageSheetsPage({
  params,
}: {
  params: Promise<{ id: string; stageId: string }>;
}) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState('');
  const [stageId, setStageId] = useState('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
      setStageId(resolved.stageId);
    };
    resolve();
  }, [params]);

  useEffect(() => {
    if (!rallyId || !stageId) return;

    const load = async () => {
      try {
        setLoading(true);
        const [rallyRes, stagesRes, routesRes, participantsRes, sheetsRes] = await Promise.all([
          fetch(`/api/rallies/${rallyId}`),
          fetch(`/api/stages?rallyId=${rallyId}`),
          fetch(`/api/rallies/${rallyId}/routes`),
          fetch(`/api/rallies/${rallyId}/participants`),
          fetch(`/api/answersheets?stageId=${stageId}`),
        ]);
        if (!rallyRes.ok || !stagesRes.ok || !sheetsRes.ok) throw new Error('Failed to load');

        setRally(await rallyRes.json());
        setStages(await stagesRes.json());
        setRoutes(routesRes.ok ? (await routesRes.json()).routes || [] : []);
        setParticipants(participantsRes.ok ? await participantsRes.json() : []);
        setSheets(await sheetsRes.json());
        setError(null);
      } catch (err) {
        console.error(err);
        setError('Failed to load the answer sheets. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [rallyId, stageId]);

  const stageIndex = stages.findIndex((stage) => stage._id === stageId);
  const stage = stageIndex >= 0 ? stages[stageIndex] : null;
  const routeName = (routeId?: string | null) =>
    routes.find((route) => route._id === routeId)?.name;

  // Every crew of the entry list, plus any EQ that has a sheet for this stage
  // without being on it (a sheet older than the entry list) — a card that
  // exists is never hidden.
  const rows = useMemo<Row[]>(() => {
    const byEq = new Map<number, Row>();
    participants.forEach((participant) =>
      byEq.set(participant.eq, { eq: participant.eq, participant, state: 'none' })
    );
    sheets.forEach((sheet) => {
      const row = byEq.get(sheet.eq) || { eq: sheet.eq, state: 'none' as CardState };
      byEq.set(sheet.eq, { ...row, sheet, state: cardState(sheet) });
    });
    return Array.from(byEq.values()).sort((a, b) => a.eq - b.eq);
  }, [participants, sheets]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      typed: rows.filter((row) => row.state === 'typed').length,
      times: rows.filter((row) => row.state === 'times').length,
      none: rows.filter((row) => row.state === 'none').length,
    }),
    [rows]
  );

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== 'all' && row.state !== filter) return false;
      if (!needle) return true;
      return (
        String(row.eq) === needle ||
        (row.participant?.driverName || '').toLowerCase().includes(needle) ||
        (row.participant?.navigatorName || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, filter, search]);

  if (loading && !rally) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading answer sheets...</p>
      </div>
    );
  }

  if (error || !rally || !stage) {
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

  const route = routeName(stage.routeId);
  const previous = stageIndex > 0 ? stages[stageIndex - 1] : null;
  const next = stageIndex < stages.length - 1 ? stages[stageIndex + 1] : null;
  const sheetsHref = (id: string) => `/rallies/${rallyId}/stages/${id}/sheets`;

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className={`${PAGE_CONTAINER} py-4`}>
        <div className="mb-4">
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-base">
            &larr; Back to {rally.name}
          </Link>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold text-gray-900">
              Answer Sheets — {stageIndex + 1}. {stage.name}
            </h1>
            {route && (
              <span className="text-base font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5">
                {route}
              </span>
            )}
          </div>
          <p className="text-gray-700 text-base">
            Every crew of the entry list in EQ order, with this traject&apos;s card. Open a card to
            read it, edit it to correct it, or enter the card of a crew who has none yet.
          </p>
        </div>

        {/* Which traject: the select jumps straight to another one, the arrows
            walk the running order. */}
        <div className="bg-white rounded-xl shadow border-2 border-gray-200 mb-4 px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-2">
            {previous ? (
              <Link
                href={sheetsHref(previous._id)}
                className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-base"
                title={`Previous: ${previous.name}`}
              >
                &larr;
              </Link>
            ) : (
              <span className="px-3 py-2 text-gray-300 text-base">&larr;</span>
            )}
            <label htmlFor="sheets-stage" className="sr-only">
              Traject
            </label>
            <select
              id="sheets-stage"
              value={stageId}
              onChange={(event) => router.push(sheetsHref(event.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {stages.map((option, index) => {
                const optionRoute = routeName(option.routeId);
                return (
                  <option key={option._id} value={option._id}>
                    {index + 1}. {option.name}
                    {optionRoute ? ` — ${optionRoute}` : ''}
                  </option>
                );
              })}
            </select>
            {next ? (
              <Link
                href={sheetsHref(next._id)}
                className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-base"
                title={`Next: ${next.name}`}
              >
                &rarr;
              </Link>
            ) : (
              <span className="px-3 py-2 text-gray-300 text-base">&rarr;</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'typed', 'times', 'none'] as Filter[]).map((option) => (
              <button
                key={option}
                onClick={() => setFilter(option)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  filter === option
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {option === 'all' ? 'All' : STATE_LABEL[option]} ({counts[option]})
              </button>
            ))}
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="EQ or name"
              className="ml-1 w-40 px-3 py-1.5 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-bold uppercase tracking-wider text-gray-600">
                <th className="px-4 py-3">EQ</th>
                <th className="px-4 py-3">Kl.</th>
                <th className="px-4 py-3">Navigator</th>
                <th className="px-4 py-3">Bestuurder</th>
                <th className="px-4 py-3">Card</th>
                <th className="px-4 py-3 text-right">ORC&apos;s</th>
                <th className="px-4 py-3 text-right">Tijd</th>
                <th className="px-4 py-3 text-right">Div.</th>
                <th className="px-4 py-3 text-right">Totaal</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRows.map((row) => {
                const sheet = row.sheet;
                const total = sheet?.totalPenalty ?? 0;
                const time = sheet?.timePenalty ?? 0;
                const merk = sheet?.merkPenalty ?? 0;

                return (
                  <tr key={row.eq} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-base font-bold text-gray-900">{row.eq}</td>
                    <td className="px-4 py-2">
                      <ClassificationBadge classification={row.participant?.classification} />
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-800">
                      {row.participant?.navigatorName || (
                        <span className="text-gray-400">
                          {row.participant ? '—' : 'Not on the entry list'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-800">
                      {row.participant?.driverName || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${STATE_STYLE[row.state]}`}
                      >
                        {STATE_LABEL[row.state]}
                      </span>
                      {sheet?.disqualified && (
                        <span
                          className="ml-1 inline-block px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800"
                          title="Outside the finish window of the rally's last stage, or no finish time"
                        >
                          DNF
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-sm">
                      {sheet ? total - time - merk : ''}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-sm">
                      {sheet ? time : ''}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-sm">
                      {sheet ? merk : ''}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-base font-bold">
                      {sheet ? total : <span className="text-gray-400 font-normal">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {sheet ? (
                        <div className="flex justify-end gap-4">
                          <Link
                            href={`/rallies/${rallyId}/answer-sheets/${sheet._id}`}
                            className="text-blue-600 hover:text-blue-900 font-medium text-base"
                          >
                            View
                          </Link>
                          <Link
                            href={`/rallies/${rallyId}/answer-sheets/${sheet._id}/edit`}
                            className="text-indigo-600 hover:text-indigo-900 font-medium text-base"
                          >
                            {row.state === 'times' ? 'Type card' : 'Edit'}
                          </Link>
                        </div>
                      ) : row.participant ? (
                        <Link
                          href={`/rallies/${rallyId}/answer-sheets?stageId=${stageId}&eq=${row.eq}`}
                          className="text-green-700 hover:text-green-900 font-medium text-base"
                        >
                          Enter card
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-base text-gray-500">
                    {rows.length === 0
                      ? 'No crews yet — add the entry list on the Participants tab first.'
                      : 'No crews match this filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
