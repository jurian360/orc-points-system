'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ClassificationBadge from './ClassificationBadge';
import { CLASSIFICATIONS, crewLabel, type ClassificationValue } from '../lib/participants';
import type { RallyTimeCell, RallyTimeStage, RallyTimes } from '../types';

interface RallyTimesPanelProps {
  rallyId: string;
  // How many stages the overview holds, so the page can label its tab without
  // fetching the times a second time.
  onStageCountChange?: (count: number) => void;
}

// What a cell shows underneath the WPT. The WPT itself is what this page is
// for; the rest is the context an official wants while they are checking one
// control, and only one of them fits in a cell.
type Detail = 'delta' | 'ipt' | 'strafp' | 'none';

const DETAIL_LABELS: Record<Detail, string> = {
  delta: 'WPT + ⁺∕₋',
  ipt: 'WPT + IPT',
  strafp: 'WPT + strafp.',
  none: 'WPT only',
};

// The WPT overview of a rally: every control of every stage, with the time each
// crew passed it.
//
// A card shows one crew's time column; this is the other way round — one table
// per stage, a row per crew and a column per control, START and FINISH
// included. It is what an official reads after a control has handed its export
// in: did every crew get a time, and which of them came in outside their window.
//
// Nothing is scored here. The times, the deltas and the points come off the
// stored sheets exactly as `app/lib/rescore.ts` wrote them, so this overview and
// the controlekaart can never disagree.
const RallyTimesPanel: React.FC<RallyTimesPanelProps> = ({ rallyId, onStageCountChange }) => {
  const [data, setData] = useState<RallyTimes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  // '' is every stage, stacked in running order — what the page opens on.
  const [stageFilter, setStageFilter] = useState('');
  const [detail, setDetail] = useState<Detail>('delta');
  // Held in a ref so an inline callback from the page cannot re-create
  // `loadTimes` on every render and fetch in a loop.
  const stageCountRef = useRef(onStageCountChange);
  stageCountRef.current = onStageCountChange;

  const loadTimes = useCallback(async () => {
    if (!rallyId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/rallies/${rallyId}/times`);
      if (!response.ok) throw new Error('Failed to fetch rally times');
      const payload: RallyTimes = await response.json();
      setData(payload);
      stageCountRef.current?.(payload.stages.length);
      setError(null);
    } catch (err) {
      setError('Failed to load the times of this rally.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    loadTimes();
  }, [loadTimes]);

  // Who rides under an EQ number. A crew that only exists as a sheet has no
  // record, so the row still shows — with an empty class and no names.
  const detailsByEq = useMemo(() => {
    const map = new Map<
      number,
      { classification: ClassificationValue; driverName: string; navigatorName: string }
    >();
    for (const participant of data?.participants || []) map.set(participant.eq, participant);
    return map;
  }, [data]);

  // The same filter over every stage table: a control is checked for one crew,
  // or for one class, across the whole rally.
  const matches = useCallback(
    (eq: number) => {
      const details = detailsByEq.get(eq);
      if (classFilter && (details?.classification || '') !== classFilter) return false;
      const term = search.trim().toLowerCase();
      if (!term) return true;
      if (String(eq) === term || String(eq).startsWith(term)) return true;
      return crewLabel(details).toLowerCase().includes(term);
    },
    [detailsByEq, search, classFilter]
  );

  const visibleStages = useMemo(() => {
    const stages = data?.stages || [];
    return stageFilter ? stages.filter((stage) => stage._id === stageFilter) : stages;
  }, [data, stageFilter]);

  // Which of the 10 rows this stage's table has a column for: the controls it
  // uses, plus any row a time was imported onto without the key holding an IPT 0
  // for it — that mismatch is exactly what this page should show.
  const columnsOf = (stage: RallyTimeStage) =>
    stage.columns.filter(
      (column) =>
        column.active || stage.entries.some((entry) => entry.cells[column.rowNumber - 1]?.wpt)
    );

  const renderCell = (cell: RallyTimeCell | undefined, active: boolean, hasSheet: boolean) => {
    if (!cell || (!cell.wpt && !cell.missing)) {
      return (
        <span className="text-gray-300" title={hasSheet ? 'No time' : 'No sheet for this stage'}>
          —
        </span>
      );
    }

    // The stage uses this control but the sheet has no time for it: the crew
    // missed it and was charged the maximum.
    if (cell.missing && !cell.wpt) {
      return (
        <span
          className="font-bold text-red-600"
          title={`Missed — ${cell.strafp} penalty point${cell.strafp === 1 ? '' : 's'}`}
        >
          gemist
        </span>
      );
    }

    const sub =
      detail === 'delta'
        ? cell.plusMinus
        : detail === 'ipt'
          ? cell.ipt
          : detail === 'strafp'
            ? cell.strafp > 0
              ? `${cell.strafp} p.`
              : ''
            : '';

    return (
      <>
        <span
          className={`font-mono font-semibold ${
            !active
              ? 'text-amber-700'
              : cell.outOfWindow
                ? 'text-red-600'
                : 'text-gray-900'
          }`}
          title={
            !active
              ? 'This stage has no IPT 0 for this control, so the time is not scored'
              : cell.outOfWindow
                ? `Outside the window — ${cell.strafp} penalty points`
                : undefined
          }
        >
          {cell.wpt}
        </span>
        {sub && (
          <span
            className={`block text-xs font-mono ${
              cell.outOfWindow || cell.missing ? 'text-red-500' : 'text-gray-500'
            }`}
          >
            {sub}
          </span>
        )}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="px-6 py-4 flex flex-wrap justify-between items-end gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Times (WPT)</h2>
            <p className="text-gray-600 text-sm mt-1">
              Every control of every stage, in running order: the time each crew passed it, START
              and FINISH included. A time in red was outside its window, an amber one sits on a row
              the stage key has no IPT 0 for. The numbers are the ones stored on the cards — to
              change one, correct the sheet or import the control again.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search EQ or crew"
              aria-label="Search the times"
              className="px-3 py-2 border border-gray-300 rounded-md text-base w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
              aria-label="Filter by classification"
              className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All classes</option>
              {CLASSIFICATIONS.map((value) => (
                <option key={value} value={value}>
                  Class {value}
                </option>
              ))}
            </select>
            <select
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value)}
              aria-label="Show one stage"
              className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All stages</option>
              {(data?.stages || []).map((stage, index) => (
                <option key={stage._id} value={stage._id}>
                  {index + 1}. {stage.name}
                </option>
              ))}
            </select>
            <select
              value={detail}
              onChange={(event) => setDetail(event.target.value as Detail)}
              aria-label="What every cell shows under the WPT"
              className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {(Object.keys(DETAIL_LABELS) as Detail[]).map((value) => (
                <option key={value} value={value}>
                  {DETAIL_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-6 py-3 text-base font-medium">
            <p>{error}</p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <p className="text-lg text-gray-600">Loading times...</p>
        </div>
      ) : !data || data.stages.length === 0 ? (
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <p className="text-lg text-gray-600">
            No stages yet. A stage holds the timetable (IPT 0) the times are read against.
          </p>
        </div>
      ) : (
        visibleStages.map((stage) => {
          const columns = columnsOf(stage);
          const position = data.stages.findIndex((entry) => entry._id === stage._id) + 1;
          const rows = stage.entries.filter((entry) => matches(entry.eq));
          const withTimes = stage.entries.filter((entry) =>
            entry.cells.some((cell) => cell.wpt)
          ).length;

          return (
            <div key={stage._id} className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap justify-between items-center gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">
                    <span className="text-gray-400 mr-2">{position}.</span>
                    {stage.name}
                  </h3>
                  <p className="text-gray-600 text-sm mt-1">
                    {columns.length} control{columns.length === 1 ? '' : 's'} · {withTimes} of{' '}
                    {stage.entries.length} crew{stage.entries.length === 1 ? '' : 's'} with a time
                  </p>
                </div>
                <Link
                  href={`/time-import?rallyId=${rallyId}&stageId=${stage._id}`}
                  className="text-emerald-700 hover:text-emerald-900 font-medium text-base"
                >
                  Import Times
                </Link>
              </div>

              {columns.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-base text-gray-600">
                    This stage has no timetable yet — add the IPT 0 times to its time key, then
                    import the times of its controls.
                  </p>
                </div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-base text-gray-600">
                    {stage.entries.length === 0
                      ? 'No crews in this rally yet. Import the entry list first.'
                      : 'No crew matches this filter.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="sticky left-0 z-10 bg-gray-100 px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                          EQ
                        </th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                          Class
                        </th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                          Crew
                        </th>
                        {columns.map((column) => (
                          <th
                            key={column.rowNumber}
                            className="px-3 py-2 text-center text-sm font-semibold text-gray-700 uppercase tracking-wider whitespace-nowrap"
                          >
                            {column.label}
                            {/* The IPT 0 the column is measured against: every
                                crew's own ideal time is this plus their EQ. */}
                            <span className="block text-xs font-mono font-normal normal-case text-gray-500">
                              {column.active ? `IPT 0 ${column.ipt0}` : 'no IPT 0'}
                            </span>
                          </th>
                        ))}
                        <th className="px-4 py-2 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                          Tijd
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {rows.map((entry) => {
                        const details = detailsByEq.get(entry.eq);
                        return (
                          <tr
                            key={entry.eq}
                            className={entry.disqualified ? 'bg-red-50' : 'hover:bg-gray-50'}
                          >
                            <td
                              className={`sticky left-0 z-10 px-4 py-2 whitespace-nowrap ${
                                entry.disqualified ? 'bg-red-50' : 'bg-white'
                              }`}
                            >
                              <Link
                                href={`/rallies/${rallyId}/participants/${entry.eq}`}
                                className="text-base font-bold text-blue-600 hover:underline"
                              >
                                {entry.eq}
                              </Link>
                              {entry.disqualified && (
                                <span
                                  className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-xs font-bold"
                                  title="Outside the finish window of the last stage, or never finished it"
                                >
                                  DQ
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <ClassificationBadge classification={details?.classification} />
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-sm text-gray-800">
                                {crewLabel(details) || <span className="text-gray-400">—</span>}
                              </span>
                            </td>
                            {columns.map((column) => (
                              <td
                                key={column.rowNumber}
                                className="px-3 py-2 whitespace-nowrap text-center text-base"
                              >
                                {renderCell(
                                  entry.cells[column.rowNumber - 1],
                                  column.active,
                                  entry.hasSheet
                                )}
                              </td>
                            ))}
                            <td className="px-4 py-2 whitespace-nowrap text-right">
                              <span
                                className={`text-base font-semibold ${
                                  entry.timePenalty > 0 ? 'text-red-600' : 'text-gray-400'
                                }`}
                              >
                                {entry.hasSheet ? entry.timePenalty : '—'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default RallyTimesPanel;
