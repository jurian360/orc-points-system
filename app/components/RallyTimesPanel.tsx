'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ClassificationBadge from './ClassificationBadge';
import { CLASSIFICATIONS, crewLabel, type ClassificationValue } from '../lib/participants';
import type { RallyTimeCell, RallyTimeEntry, RallyTimeStage, RallyTimes } from '../types';

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

// The three crew columns are frozen while the stages scroll past them, so their
// widths have to be exact: each one is offset by the sum of the widths before
// it (0, 56, 56+60). Changing a width means changing the offset after it.
const CREW_COLUMNS = {
  eq: 'w-[56px] min-w-[56px] left-0',
  classification: 'w-[60px] min-w-[60px] left-[56px]',
  crew: 'w-[168px] min-w-[168px] left-[116px]',
};

// Height of the stage row of the header, which the control row sticks to.
const STAGE_ROW = 'h-8';
const CONTROL_ROW_TOP = 'top-8';

// The WPT overview of a rally: every control of every stage, with the time each
// crew passed it.
//
// A card shows one crew's time column; this is the other way round — one row per
// crew, running the whole rally left to right: the stages sit side by side, each
// with a column per control (START, the GTC's it uses, FINISH) and its own Tijd
// total. It is what an official reads after a control has handed its export in:
// did every crew get a time, and which of them came in outside their window.
//
// The grid scrolls inside itself in both directions, with the crew columns and
// the two header rows frozen: on a real rally it is 56 crews wide and a dozen
// controls long, and neither the name of a crew nor the name of a control may
// scroll out of sight. That is also why the table is `border-separate` — with
// collapsed borders a sticky cell loses them.
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
  // '' is every stage side by side — what the page opens on.
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

  // One row per crew, whatever the rally has stages: every EQ that appears in
  // any stage, in number order.
  const eqs = useMemo(() => {
    const all = new Set<number>();
    for (const stage of data?.stages || []) {
      for (const entry of stage.entries) all.add(entry.eq);
    }
    return Array.from(all).sort((a, b) => a - b);
  }, [data]);

  // The stages to lay side by side, each with the columns it actually needs:
  // the controls it uses, plus any row a time was imported onto without the key
  // holding an IPT 0 for it — that mismatch is what this page should show.
  const groups = useMemo(() => {
    const stages = data?.stages || [];
    return stages
      .map((stage: RallyTimeStage, index) => ({
        stage,
        position: index + 1,
        columns: stage.columns.filter(
          (column) =>
            column.active || stage.entries.some((entry) => entry.cells[column.rowNumber - 1]?.wpt)
        ),
        entriesByEq: new Map<number, RallyTimeEntry>(
          stage.entries.map((entry) => [entry.eq, entry])
        ),
        withTimes: stage.entries.filter((entry) => entry.cells.some((cell) => cell.wpt)).length,
      }))
      .filter(({ stage }) => !stageFilter || stage._id === stageFilter);
  }, [data, stageFilter]);

  // The same filter over the whole grid: a control is checked for one crew, or
  // for one class, across every stage at once.
  const visibleEqs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return eqs.filter((eq) => {
      const details = detailsByEq.get(eq);
      if (classFilter && (details?.classification || '') !== classFilter) return false;
      if (!term) return true;
      if (String(eq) === term || String(eq).startsWith(term)) return true;
      return crewLabel(details).toLowerCase().includes(term);
    });
  }, [eqs, detailsByEq, search, classFilter]);

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
          className="font-semibold text-red-600"
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
            !active ? 'text-amber-700' : cell.outOfWindow ? 'text-red-600' : 'text-gray-900'
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
            className={`block text-[11px] leading-tight font-mono ${
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
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow px-4 py-3 flex flex-wrap justify-between items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Times (WPT)</h2>
          <p className="text-gray-600 text-sm mt-0.5">
            One row per crew, the stages side by side in running order — every control, START and
            FINISH included. Red was outside its window, amber sits on a row with no IPT 0. To
            change a time, correct the sheet or import the control again.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search EQ or crew"
            aria-label="Search the times"
            className="px-3 py-1.5 border border-gray-300 rounded-md text-base w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value)}
            aria-label="Filter by classification"
            className="px-3 py-1.5 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="px-3 py-1.5 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="px-3 py-1.5 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-2 text-base font-medium rounded">
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-lg text-gray-600">Loading times...</p>
        </div>
      ) : !data || data.stages.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-lg text-gray-600">
            No stages yet. A stage holds the timetable (IPT 0) the times are read against.
          </p>
        </div>
      ) : visibleEqs.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-lg text-gray-600">
            {eqs.length === 0
              ? 'No crews in this rally yet. Import the entry list first.'
              : 'No crew matches this filter.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-auto max-h-[calc(100vh-27rem)] min-h-[18rem]">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              {/* The stages, side by side. Each spans its controls plus its own
                  Tijd total, and the heading is the way into that stage's time
                  import. */}
              <tr>
                <th
                  rowSpan={2}
                  className={`sticky top-0 z-30 ${CREW_COLUMNS.eq} bg-gray-100 px-2 py-1 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-300`}
                >
                  EQ
                </th>
                <th
                  rowSpan={2}
                  className={`sticky top-0 z-30 ${CREW_COLUMNS.classification} bg-gray-100 px-2 py-1 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-300`}
                >
                  Class
                </th>
                <th
                  rowSpan={2}
                  className={`sticky top-0 z-30 ${CREW_COLUMNS.crew} bg-gray-100 px-2 py-1 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-r-2 border-gray-300`}
                >
                  Crew
                </th>
                {groups.map(({ stage, position, columns, withTimes }) => (
                  <th
                    key={stage._id}
                    colSpan={columns.length + 1}
                    className={`sticky top-0 z-20 ${STAGE_ROW} bg-gray-200 px-2 text-left text-sm font-semibold text-gray-800 whitespace-nowrap border-b border-l-2 border-gray-300`}
                  >
                    <Link
                      href={`/time-import?rallyId=${rallyId}&stageId=${stage._id}`}
                      className="hover:underline"
                      title="Import the times of a control of this stage"
                    >
                      <span className="text-gray-500">{position}.</span> {stage.name}
                    </Link>
                    <span className="ml-2 text-xs font-normal text-gray-600">
                      {columns.length === 0
                        ? 'no timetable yet'
                        : `${columns.length} controls · ${withTimes}/${stage.entries.length} with a time`}
                    </span>
                  </th>
                ))}
              </tr>
              {/* The controls of each stage, headed with the IPT 0 they are
                  measured against: every crew's own ideal time is it plus their
                  EQ number. */}
              <tr>
                {groups.flatMap(({ stage, columns }) => [
                  ...columns.map((column, index) => (
                    <th
                      key={`${stage._id}-${column.rowNumber}`}
                      className={`sticky ${CONTROL_ROW_TOP} z-20 bg-gray-100 px-2 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider whitespace-nowrap border-b border-gray-300 ${
                        index === 0 ? 'border-l-2' : ''
                      }`}
                    >
                      {column.label}
                      <span className="block text-[11px] font-mono font-normal normal-case text-gray-500">
                        {column.active ? column.ipt0 : 'geen IPT'}
                      </span>
                    </th>
                  )),
                  <th
                    key={`${stage._id}-tijd`}
                    className={`sticky ${CONTROL_ROW_TOP} z-20 bg-gray-100 px-2 py-1 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider border-b border-gray-300 ${
                      columns.length === 0 ? 'border-l-2' : ''
                    }`}
                    title="The time penalty this stage cost the crew"
                  >
                    Tijd
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {visibleEqs.map((eq) => {
                const details = detailsByEq.get(eq);
                // Disqualification is a fact about the rally, not about one
                // stage: the crew missed the finish window of the last one.
                const disqualified = groups.some(
                  ({ entriesByEq }) => entriesByEq.get(eq)?.disqualified
                );
                const rowBackground = disqualified ? 'bg-red-50' : 'bg-white';

                return (
                  <tr key={eq} className={disqualified ? 'bg-red-50' : 'hover:bg-gray-50'}>
                    <td
                      className={`sticky z-10 ${CREW_COLUMNS.eq} ${rowBackground} px-2 py-1 whitespace-nowrap border-b border-gray-200`}
                    >
                      <Link
                        href={`/rallies/${rallyId}/participants/${eq}`}
                        className="font-bold text-blue-600 hover:underline"
                      >
                        {eq}
                      </Link>
                      {disqualified && (
                        <span
                          className="ml-1 px-1 rounded bg-red-100 text-red-800 text-[10px] font-bold align-middle"
                          title="Outside the finish window of the last stage, or never finished it"
                        >
                          DQ
                        </span>
                      )}
                    </td>
                    <td
                      className={`sticky z-10 ${CREW_COLUMNS.classification} ${rowBackground} px-2 py-1 whitespace-nowrap border-b border-gray-200`}
                    >
                      <ClassificationBadge classification={details?.classification} />
                    </td>
                    <td
                      className={`sticky z-10 ${CREW_COLUMNS.crew} ${rowBackground} px-2 py-1 border-b border-r-2 border-gray-200 border-r-gray-300`}
                    >
                      <span className="block truncate text-gray-800" title={crewLabel(details)}>
                        {crewLabel(details) || <span className="text-gray-400">—</span>}
                      </span>
                    </td>
                    {groups.flatMap(({ stage, columns, entriesByEq }) => {
                      const entry = entriesByEq.get(eq);
                      return [
                        ...columns.map((column, index) => (
                          <td
                            key={`${stage._id}-${column.rowNumber}`}
                            className={`px-2 py-1 whitespace-nowrap text-center border-b border-gray-200 ${
                              index === 0 ? 'border-l-2 border-l-gray-300' : ''
                            }`}
                          >
                            {renderCell(
                              entry?.cells[column.rowNumber - 1],
                              column.active,
                              Boolean(entry?.hasSheet)
                            )}
                          </td>
                        )),
                        <td
                          key={`${stage._id}-tijd`}
                          className={`px-2 py-1 whitespace-nowrap text-right border-b border-gray-200 ${
                            columns.length === 0 ? 'border-l-2 border-l-gray-300' : ''
                          }`}
                        >
                          <span
                            className={`font-semibold ${
                              entry && entry.timePenalty > 0 ? 'text-red-600' : 'text-gray-400'
                            }`}
                          >
                            {entry?.hasSheet ? entry.timePenalty : '—'}
                          </span>
                        </td>,
                      ];
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RallyTimesPanel;
