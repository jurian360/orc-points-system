'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { CLASSIFICATIONS, type ClassificationValue } from '../../../../lib/participants';

// The standings on paper, one sheet per classification.
//
// The dashboard's standings tab is one long table of the whole field, which is
// what an official reads on a screen. What goes on the wall at the finish is
// something else: a class rides against its own class, so every class gets its
// own A4 with its own 1, 2, 3 — the rank here is the crew's place *within their
// class*, not their place in the field.
//
// The columns are the ones a result sheet needs and no more: the place, the EQ,
// the crew (navigator and driver in their own columns, so the names line up
// down the page instead of running into one string) and the four numbers —
// ORC's, Tijd, Diversen and the total that decides it. Nothing here is scored:
// it is `GET /api/rallies/[id]/standings` read onto paper, so a printed sheet
// and the screen cannot disagree.
//
// A crew whose class was never recorded is not dropped — they get a sheet of
// their own at the back, because a missing class is a gap in the entry list, not
// a reason to leave a scored crew off the results.
//
// This is the one full-page view that does not use `PAGE_CONTAINER`, for the
// same reason a form does not: its width is not the window but the paper. The
// sheets are laid out at roughly an A4 column so what an official sees on screen
// is what comes out of the printer.

interface Rally {
  _id: string;
  name: string;
  code?: string;
}

interface StandingsEntry {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  sheetsSubmitted: number;
  disqualified: boolean;
  rank: number;
}

// The sheets, in order: the five classes as they are written on the entry list,
// then the crews without one.
const SECTION_CLASSES: ClassificationValue[] = [...CLASSIFICATIONS, ''];

const classLabel = (value: ClassificationValue) =>
  value ? `Klasse ${value}` : 'Zonder klasse';

// Print rules that Tailwind has no utility for: the paper size itself, the page
// break between two classes and the header row that repeats when a class runs
// over one sheet. Kept on this page rather than in globals.css — the QR sheet
// prints its cards on the browser's own default page and should stay that way.
const PRINT_STYLES = `
  @media print {
    @page {
      size: A4 portrait;
      margin: 14mm 12mm;
    }

    /* Each class starts on a fresh sheet; the last one does not add a blank. */
    .standings-sheet {
      break-after: page;
      page-break-after: always;
    }

    .standings-sheet:last-of-type {
      break-after: auto;
      page-break-after: auto;
    }

    /* A class longer than one sheet keeps its column headings on every page. */
    .standings-sheet thead {
      display: table-header-group;
    }

    .standings-sheet tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
`;

export default function StandingsPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [rallyId, setRallyId] = useState('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [standings, setStandings] = useState<StandingsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which classes to print: every one that has crews, or a single sheet. The
  // dashboard passes its own filter along in `?class=`, so Print from a filtered
  // standing prints what is on screen.
  const [selected, setSelected] = useState<ClassificationValue | 'all'>('all');

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    resolve();
  }, [params]);

  // Read the class the dashboard was filtered on. It is only a preselection —
  // the select below is what decides what is printed.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('class');
    if (requested === null) return;
    if (requested === '' || (CLASSIFICATIONS as readonly string[]).includes(requested)) {
      setSelected(requested as ClassificationValue);
    }
  }, []);

  const load = useCallback(async () => {
    if (!rallyId) return;

    try {
      const [rallyRes, standingsRes] = await Promise.all([
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/rallies/${rallyId}/standings`),
      ]);

      if (!rallyRes.ok) throw new Error('Failed to fetch rally');
      setRally(await rallyRes.json());

      if (!standingsRes.ok) throw new Error('Failed to fetch standings');
      const data = await standingsRes.json();
      setStandings(data.standings || []);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load the standings. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    load();
  }, [load]);

  // One section per class that has crews. The standings arrive ranked over the
  // whole field — disqualified last, then on total, then on EQ — and filtering
  // keeps that order, so the place within a class is simply the position in what
  // is left.
  const sections = useMemo(
    () =>
      SECTION_CLASSES.map((classification) => ({
        classification,
        entries: standings
          .filter((entry) => (entry.classification || '') === classification)
          .map((entry, index) => ({ ...entry, classRank: index + 1 })),
      })).filter((section) => section.entries.length > 0),
    [standings]
  );

  const printedSections = useMemo(
    () =>
      selected === 'all'
        ? sections
        : sections.filter((section) => section.classification === selected),
    [sections, selected]
  );

  const printedOn = useMemo(
    () =>
      new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    []
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading standings...</p>
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

  return (
    <div className="min-h-screen bg-gray-100 py-4 print:bg-white print:py-0">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* Everything in here is for the official at the screen, not for paper */}
      <div className="print:hidden mx-auto w-full max-w-[900px] px-4 sm:px-6">
        <div className="mb-4">
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-base">
            &larr; Back to {rally.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">
            Print Standings — {rally.name}
          </h1>
          <p className="text-gray-700 text-base">
            One A4 sheet per classification, each ranked within its own class. The numbers are the
            standings as they are on screen — printing scores nothing of its own.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mb-6 px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="print-class" className="text-base font-medium text-gray-700">
              Print:
            </label>
            <select
              id="print-class"
              value={selected}
              onChange={(event) => setSelected(event.target.value as ClassificationValue | 'all')}
              className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All classes — one sheet each</option>
              {sections.map((section) => (
                <option key={section.classification || 'none'} value={section.classification}>
                  {classLabel(section.classification)} ({section.entries.length})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-base text-gray-700">
              {printedSections.length} sheet{printedSections.length === 1 ? '' : 's'} ·{' '}
              {printedSections.reduce((total, section) => total + section.entries.length, 0)} crews
            </span>
            <button
              onClick={() => window.print()}
              disabled={printedSections.length === 0}
              className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-base transition-colors disabled:opacity-50"
            >
              Print
            </button>
          </div>
        </div>

        {error && <p className="text-red-600 font-medium text-base mb-4">{error}</p>}

        {printedSections.length === 0 && (
          <div className="bg-white rounded-xl shadow border-2 border-gray-200 p-8 text-center">
            <p className="text-lg text-gray-600">
              Nothing to print yet. A crew appears on the standings once they have an answer sheet.
            </p>
          </div>
        )}
      </div>

      {/* The sheets themselves: an A4 page on screen, an A4 page on paper */}
      <div className="mx-auto w-full max-w-[900px] px-4 sm:px-6 print:max-w-none print:px-0">
        {printedSections.map((section) => (
          <section
            key={section.classification || 'none'}
            className="standings-sheet bg-white rounded-lg shadow-lg border border-gray-200 p-8 mb-6 print:shadow-none print:rounded-none print:border-0 print:p-0 print:mb-0"
          >
            <header className="flex justify-between items-end border-b-2 border-gray-800 pb-2 mb-3">
              <div>
                <h2 className="text-xl font-bold text-black">
                  {rally.name}
                  {rally.code ? <span className="ml-2 text-base font-normal">({rally.code})</span> : null}
                </h2>
                <p className="text-lg font-semibold text-black">
                  Uitslag — {classLabel(section.classification)}
                </p>
              </div>
              <div className="text-right text-xs text-gray-600">
                <p>
                  {section.entries.length} equipe{section.entries.length === 1 ? '' : 's'}
                </p>
                <p>{printedOn}</p>
              </div>
            </header>

            <table className="w-full table-fixed border-collapse text-black">
              {/* The numbers get exactly the room four digits need; what is
                  left is the crew's, because a name that does not fit is the one
                  thing on this sheet that cannot be abbreviated. A long name
                  wraps onto a second line rather than being cut off. */}
              <colgroup>
                <col className="w-14" />
                <col className="w-10" />
                <col />
                <col />
                <col className="w-14" />
                <col className="w-14" />
                <col className="w-14" />
                <col className="w-14" />
              </colgroup>
              <thead>
                <tr className="border-b-2 border-gray-800">
                  <th className="py-1 pr-1 text-left text-xs font-bold uppercase tracking-wide">
                    Stand
                  </th>
                  <th className="py-1 px-1 text-left text-xs font-bold uppercase tracking-wide">
                    EQ
                  </th>
                  <th className="py-1 px-1 text-left text-xs font-bold uppercase tracking-wide">
                    Navigator
                  </th>
                  <th className="py-1 px-1 text-left text-xs font-bold uppercase tracking-wide">
                    Bestuurder
                  </th>
                  <th className="py-1 px-1 text-right text-xs font-bold uppercase tracking-wide">
                    ORC&apos;s
                  </th>
                  <th className="py-1 px-1 text-right text-xs font-bold uppercase tracking-wide">
                    Tijd
                  </th>
                  <th
                    className="py-1 px-1 text-right text-xs font-bold uppercase tracking-wide"
                    title="The merk column of every sheet"
                  >
                    Div.
                  </th>
                  <th className="py-1 pl-1 text-right text-xs font-bold uppercase tracking-wide">
                    Totaal
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.entries.map((entry) => (
                  <tr key={entry.eq} className="border-b border-gray-300">
                    <td className="py-1 pr-1 text-sm font-bold">
                      {entry.classRank}
                      {entry.disqualified && (
                        <span className="ml-1 text-xs font-bold" title="Disqualified">
                          DQ
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-1 text-sm font-bold">{entry.eq}</td>
                    <td className="py-1 px-1 text-sm break-words">
                      {entry.navigatorName || '—'}
                    </td>
                    <td className="py-1 px-1 text-sm break-words">
                      {entry.driverName || '—'}
                    </td>
                    <td className="py-1 px-1 text-sm text-right tabular-nums">
                      {entry.orcPenalty}
                    </td>
                    <td className="py-1 px-1 text-sm text-right tabular-nums">
                      {entry.timePenalty}
                    </td>
                    <td className="py-1 px-1 text-sm text-right tabular-nums">
                      {entry.merkPenalty}
                    </td>
                    <td className="py-1 pl-1 text-sm text-right font-bold tabular-nums">
                      {entry.totalPenalty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-3 text-xs text-gray-600">
              Strafpunten — het laagste totaal wint. Een gediskwalificeerde equipe (DQ) staat achter
              iedereen die de rally nog rijdt.
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
