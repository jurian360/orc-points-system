'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { formatPrintedOn } from '../../../../components/StandingsSheet';
import { CLASSIFICATIONS, crewLabel } from '../../../../lib/participants';
import {
  TIME_DETAIL_LABELS,
  crewDetailsByEq,
  filterTimeEqs,
  isTimeDetail,
  rallyTimeEqs,
  timeCellDetail,
  visibleTimeColumns,
  type TimeDetail,
} from '../../../../lib/timesOverview';
import type { RallyTimeCell, RallyTimeEntry, RallyTimes } from '../../../../types';

// The WPT overview on paper, for checking the times against the physical cards.
//
// The Times tab lays every stage side by side, which is what a screen is for.
// An official checking a pile of control cards works through them one stage at
// a time, so the paper is **one A4 landscape sheet per stage**, headed with the
// stage's name and number (and its route on a rally ridden in legs), one row per
// crew in EQ order and a box at the end of every row to tick the card off.
//
// The filters the Times tab had on screen come along in the query string
// (`stage`, `class`, `q`, `detail`) and are only a preselection — the controls
// on this page decide what is printed.
//
// Nothing is scored here: it is `GET /api/rallies/[id]/times` read onto paper,
// the same numbers the grid shows, so the sheet and the screen cannot disagree.
//
// Like the standings print it does not use `PAGE_CONTAINER`: its width is the
// paper. The page size and the break between two sheets are the `@page` /
// `break-after` rules Tailwind has no utility for, rendered in a `<style>` here
// rather than in globals.css. Colour is kept on paper (red for a time outside
// its window), but every mark also reads in black and white: a time outside its
// window is boxed, a missed control says `gemist`.
const TIMES_PRINT_STYLES = `
  @media print {
    @page {
      size: A4 landscape;
      margin: 10mm 12mm;
    }

    .times-sheet {
      break-after: page;
      page-break-after: always;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .times-sheet:last-of-type {
      break-after: auto;
      page-break-after: auto;
    }

    /* A stage of more crews than one page holds keeps its headings on every page. */
    .times-sheet thead {
      display: table-header-group;
    }

    .times-sheet tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
`;

const ALL_STAGES = '';

export default function PrintTimesPage({ params }: { params: Promise<{ id: string }> }) {
  const [rallyId, setRallyId] = useState('');
  const [data, setData] = useState<RallyTimes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState(ALL_STAGES);
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<TimeDetail>('delta');

  useEffect(() => {
    params.then((resolved) => setRallyId(resolved.id));
  }, [params]);

  // What the Times tab was showing. Only a preselection.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const stage = query.get('stage');
    if (stage && /^[a-f0-9]{24}$/i.test(stage)) setStageFilter(stage);
    const requested = query.get('class');
    if (requested && (CLASSIFICATIONS as readonly string[]).includes(requested)) {
      setClassFilter(requested);
    }
    setSearch(query.get('q') || '');
    const requestedDetail = query.get('detail');
    if (isTimeDetail(requestedDetail)) setDetail(requestedDetail);
  }, []);

  const load = useCallback(async () => {
    if (!rallyId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/rallies/${rallyId}/times`);
      if (!response.ok) throw new Error('Failed to fetch rally times');
      setData(await response.json());
      setError(null);
    } catch (err) {
      setError('Failed to load the times of this rally.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    load();
  }, [load]);

  const detailsByEq = useMemo(() => crewDetailsByEq(data), [data]);
  const eqs = useMemo(() => rallyTimeEqs(data), [data]);
  const visibleEqs = useMemo(
    () => filterTimeEqs(eqs, detailsByEq, search, classFilter),
    [eqs, detailsByEq, search, classFilter]
  );

  // Disqualification is a fact about the rally, not about one stage, so it is
  // read over every stage whatever is printed.
  const disqualifiedEqs = useMemo(() => {
    const set = new Set<number>();
    for (const stage of data?.stages || []) {
      for (const entry of stage.entries) if (entry.disqualified) set.add(entry.eq);
    }
    return set;
  }, [data]);

  const routes = useMemo(() => data?.routes || [], [data]);

  // One sheet per stage, numbered by its place in the running order — the same
  // number the Times tab and the stage list give it.
  const sheets = useMemo(
    () =>
      (data?.stages || [])
        .map((stage, index) => {
          const routeIndex = routes.findIndex((route) => route._id === (stage.routeId || ''));
          return {
            stage,
            position: index + 1,
            route: routeIndex >= 0 ? { position: routeIndex + 1, name: routes[routeIndex].name } : null,
            columns: visibleTimeColumns(stage),
            entriesByEq: new Map<number, RallyTimeEntry>(
              stage.entries.map((entry) => [entry.eq, entry])
            ),
            withTimes: stage.entries.filter((entry) => entry.cells.some((cell) => cell.wpt)).length,
          };
        })
        .filter(({ stage }) => !stageFilter || stage._id === stageFilter),
    [data, routes, stageFilter]
  );

  const printedOn = useMemo(() => formatPrintedOn(new Date()), []);

  // What the filters left out, said on the sheet so a partial print is never
  // mistaken for the whole field.
  const filterNote = [
    classFilter ? `klasse ${classFilter}` : '',
    search.trim() ? `zoekterm “${search.trim()}”` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const renderCell = (cell: RallyTimeCell | undefined, active: boolean) => {
    if (!cell || (!cell.wpt && !cell.missing)) {
      return <span className="text-gray-400">—</span>;
    }
    if (cell.missing && !cell.wpt) {
      return <span className="font-bold text-red-700">gemist</span>;
    }
    const sub = timeCellDetail(cell, detail);
    const outside = active && cell.outOfWindow;
    return (
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        <span
          className={`font-mono font-bold ${
            outside
              ? 'text-red-700 border border-red-700 px-0.5'
              : !active
                ? 'italic text-amber-800'
                : 'text-black'
          }`}
        >
          {cell.wpt}
        </span>
        {sub && (
          <span className={`font-mono text-[10px] ${outside ? 'text-red-700' : 'text-gray-600'}`}>
            {sub}
          </span>
        )}
      </span>
    );
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading times...</p>
      </div>
    );
  }

  if (!data) {
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

  const nothingToPrint = sheets.length === 0 || visibleEqs.length === 0;

  return (
    <div className="min-h-screen bg-gray-100 py-4 print:bg-white print:py-0">
      <style dangerouslySetInnerHTML={{ __html: TIMES_PRINT_STYLES }} />

      {/* Everything in here is for the official at the screen, not for paper */}
      <div className="print:hidden mx-auto w-full max-w-[1120px] px-4 sm:px-6">
        <div className="mb-4">
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-base">
            &larr; Back to {data.rally.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">
            Print Times — {data.rally.name}
          </h1>
          <p className="text-gray-700 text-base">
            The WPT&apos;s on A4 landscape, one sheet per stage, one row per crew in EQ order with a
            box to tick off each card. A time outside its window is boxed in red, a missed control
            reads <span className="font-semibold">gemist</span>. Printing scores nothing — these are
            the times exactly as the Times tab shows them.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mb-6 px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value)}
              aria-label="Stage to print"
              className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={ALL_STAGES}>All stages — one sheet each ({data.stages.length})</option>
              {data.stages.map((stage, index) => {
                const route = routes.find((r) => r._id === (stage.routeId || ''));
                return (
                  <option key={stage._id} value={stage._id}>
                    {index + 1}. {stage.name}
                    {route ? ` (${route.name})` : ''}
                  </option>
                );
              })}
            </select>
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
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search EQ or crew"
              aria-label="Search the crews"
              className="px-3 py-2 border border-gray-300 rounded-md text-base w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={detail}
              onChange={(event) => setDetail(event.target.value as TimeDetail)}
              aria-label="What every cell shows next to the WPT"
              className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {(Object.keys(TIME_DETAIL_LABELS) as TimeDetail[]).map((value) => (
                <option key={value} value={value}>
                  {TIME_DETAIL_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-base text-gray-700 whitespace-nowrap">
              {sheets.length} sheet{sheets.length === 1 ? '' : 's'} · {visibleEqs.length} crews
            </span>
            <button
              onClick={() => window.print()}
              disabled={nothingToPrint}
              className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-base transition-colors disabled:opacity-50"
            >
              Print
            </button>
          </div>
        </div>

        {error && <p className="text-red-600 font-medium text-base mb-4">{error}</p>}

        {nothingToPrint && (
          <div className="bg-white rounded-xl shadow border-2 border-gray-200 p-8 text-center">
            <p className="text-lg text-gray-600">
              {data.stages.length === 0
                ? 'No stages yet.'
                : eqs.length === 0
                  ? 'No crews in this rally yet. Import the entry list first.'
                  : 'No crew matches this filter.'}
            </p>
          </div>
        )}
      </div>

      {/* The sheets themselves: an A4 page on screen, an A4 page on paper */}
      {!nothingToPrint && (
        <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 print:max-w-none print:px-0">
          {sheets.map(({ stage, position, route, columns, entriesByEq, withTimes }) => (
            <section
              key={stage._id}
              className="times-sheet bg-white rounded-lg shadow-lg border border-gray-200 p-8 mb-6 print:shadow-none print:rounded-none print:border-0 print:p-0 print:mb-0"
            >
              <header className="flex justify-between items-end border-b-2 border-gray-800 pb-2 mb-3">
                <div>
                  <p className="text-sm font-semibold text-black">
                    {data.rally.name}
                    {data.rally.code ? (
                      <span className="ml-1 font-normal">({data.rally.code})</span>
                    ) : null}
                    {route ? (
                      <span className="ml-2 font-normal">
                        · Route {route.position}: {route.name}
                      </span>
                    ) : null}
                  </p>
                  <h2 className="text-2xl font-bold text-black leading-tight">
                    Tijden — {position}. {stage.name}
                  </h2>
                  <p className="text-xs text-black">
                    {columns.length === 0
                      ? 'Geen tijdschema (IPT 0) voor deze proef'
                      : `${columns.length} controles · ${withTimes}/${stage.entries.length} met een tijd`}
                    {filterNote ? ` · alleen ${filterNote}` : ''}
                  </p>
                </div>
                <div className="text-right text-xs text-gray-600">
                  <p>
                    {visibleEqs.length} equipe{visibleEqs.length === 1 ? '' : 's'}
                  </p>
                  <p>{printedOn}</p>
                </div>
              </header>

              <table className="w-full border-collapse text-black text-[12px]">
                <thead>
                  <tr className="border-b-2 border-gray-800">
                    <th className="py-1 pr-1 text-left align-bottom text-[10px] font-bold uppercase tracking-wide w-10">
                      EQ
                    </th>
                    <th className="py-1 px-1 text-left align-bottom text-[10px] font-bold uppercase tracking-wide w-8">
                      Kl.
                    </th>
                    <th className="py-1 px-1 text-left align-bottom text-[10px] font-bold uppercase tracking-wide">
                      Equipe
                    </th>
                    {columns.map((column, index) => (
                      <th
                        key={column.rowNumber}
                        className={`py-1 px-1 text-center align-bottom text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${
                          index === 0 ? 'border-l-2 border-gray-800' : 'border-l border-gray-300'
                        }`}
                      >
                        {column.label}
                        <span className="block font-mono font-normal normal-case text-gray-600">
                          {column.active ? column.ipt0 : 'geen IPT'}
                        </span>
                      </th>
                    ))}
                    <th className="py-1 px-1 text-right align-bottom text-[10px] font-bold uppercase tracking-wide border-l-2 border-gray-800 w-12">
                      Tijd
                    </th>
                    <th
                      className="py-1 pl-2 text-center align-bottom text-[10px] font-bold uppercase tracking-wide w-10"
                      title="Tick off once the card has been checked"
                    >
                      ✓
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEqs.map((eq, rowIndex) => {
                    const details = detailsByEq.get(eq);
                    const entry = entriesByEq.get(eq);
                    return (
                      <tr
                        key={eq}
                        className={`border-b border-gray-300 ${rowIndex % 2 === 1 ? 'bg-gray-100' : ''}`}
                      >
                        <td className="py-1 pr-1 font-bold whitespace-nowrap">
                          {eq}
                          {disqualifiedEqs.has(eq) && (
                            <span className="ml-1 text-[9px] font-bold text-red-700">DQ</span>
                          )}
                        </td>
                        <td className="py-1 px-1">{details?.classification || ''}</td>
                        <td className="py-1 px-1 leading-tight">
                          {crewLabel(details) || <span className="text-gray-400">—</span>}
                        </td>
                        {columns.map((column, index) => (
                          <td
                            key={column.rowNumber}
                            className={`py-1 px-1 text-center ${
                              index === 0 ? 'border-l-2 border-gray-800' : 'border-l border-gray-300'
                            }`}
                          >
                            {renderCell(entry?.cells[column.rowNumber - 1], column.active)}
                          </td>
                        ))}
                        <td className="py-1 px-1 text-right font-bold border-l-2 border-gray-800">
                          {entry?.hasSheet ? entry.timePenalty : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="py-1 pl-2 text-center">
                          <span className="inline-block w-4 h-4 border border-gray-800 align-middle bg-white" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <p className="mt-2 text-[10px] text-gray-700">
                Omkaderd = buiten het venster · gemist = controle niet gepasseerd · — = geen tijd of
                geen kaart · cursief = tijd op een rij zonder IPT 0 · DQ = gediskwalificeerd ·
                IPT = IPT 0 + EQ minuten
                {detail !== 'none' ? ` · naast de WPT: ${TIME_DETAIL_LABELS[detail].replace('WPT + ', '')}` : ''}
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
