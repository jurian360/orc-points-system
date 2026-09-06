'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { CLASSIFICATIONS, type ClassificationValue } from '../../../../lib/participants';

// The standings on paper.
//
// The dashboard's standings tab is one long table of the whole field, which is
// what an official reads on a screen. What goes on the wall at the finish is a
// result sheet, and there are two of those:
//
//   * **Per klasse** — one A4 per classification, each with its own 1, 2, 3,
//     because a class rides against its own class.
//   * **Algemeen klassement** — every class together in one ranking, the whole
//     field on one sheet. It is the same order the dashboard shows, so the rank
//     here is the API's own: a crew's place in the rally.
//
// The columns are the ones a result sheet needs and no more: the place, the EQ,
// the crew (navigator and driver in their own columns, so the names line up
// down the page instead of running into one string) and the four numbers —
// ORC's, Tijd, Diversen and the total that decides it. The combined sheet adds
// the class letter, because that is the one sheet where a reader cannot tell
// which class a crew rode in from the heading.
//
// Nothing here is scored: it is `GET /api/rallies/[id]/standings` read onto
// paper, so a printed sheet and the screen cannot disagree.
//
// A crew whose class was never recorded is not dropped — they are on the
// combined sheet like everybody else, and get a sheet of their own at the back
// of the per-class print, because a missing class is a gap in the entry list,
// not a reason to leave a scored crew off the results.
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

// A crew on a sheet: a standings entry plus the place it takes *on that sheet*
// — the rally rank on the combined sheet, the place within the class on a class
// sheet.
type SheetEntry = StandingsEntry & { placing: number };

interface Sheet {
  key: string;
  title: string;
  // The combined sheet mixes the classes, so it names the class of every crew;
  // a class sheet has it in the heading already.
  showClass: boolean;
  entries: SheetEntry[];
}

// What the print covers. `combined` is the whole field on one sheet, `classes`
// is a sheet per class, and a bare class letter (or `''`, the crews without one)
// is that single class.
type PrintMode = 'combined' | 'classes' | ClassificationValue;

// The class sheets, in order: the five classes as they are written on the entry
// list, then the crews without one.
const SECTION_CLASSES: ClassificationValue[] = [...CLASSIFICATIONS, ''];

const classLabel = (value: ClassificationValue) =>
  value ? `Klasse ${value}` : 'Zonder klasse';

// Print rules that Tailwind has no utility for: the paper size itself, the page
// break between two sheets and the header row that repeats when a sheet runs
// over one page. Kept on this page rather than in globals.css — the QR sheet
// prints its cards on the browser's own default page and should stay that way.
const PRINT_STYLES = `
  @media print {
    @page {
      size: A4 portrait;
      margin: 14mm 12mm;
    }

    /* Each sheet starts on a fresh page; the last one does not add a blank. */
    .standings-sheet {
      break-after: page;
      page-break-after: always;
    }

    .standings-sheet:last-of-type {
      break-after: auto;
      page-break-after: auto;
    }

    /* A sheet longer than one page keeps its column headings on every page. */
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
  // What to print. The dashboard passes its own filter along — `?class=` for a
  // single class, `?view=combined` for the whole field — so Print from the
  // standings prints what is on screen.
  const [mode, setMode] = useState<PrintMode>('classes');

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    resolve();
  }, [params]);

  // Read what the dashboard was showing. It is only a preselection — the select
  // below is what decides what is printed.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);

    if (query.get('view') === 'combined') {
      setMode('combined');
      return;
    }

    const requested = query.get('class');
    if (requested === null) return;
    if (requested === '' || (CLASSIFICATIONS as readonly string[]).includes(requested)) {
      setMode(requested as ClassificationValue);
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

  // The whole field on one sheet, in the order the API ranked it: disqualified
  // last, then on total, then on EQ. The place is that rank — this sheet is the
  // rally's own result, so it does not re-number anything.
  const combinedSheet = useMemo<Sheet | null>(
    () =>
      standings.length === 0
        ? null
        : {
            key: 'combined',
            title: 'Algemeen klassement',
            showClass: true,
            entries: standings.map((entry) => ({ ...entry, placing: entry.rank })),
          },
    [standings]
  );

  // One sheet per class that has crews. Filtering keeps the API's order, so the
  // place within a class is simply the position in what is left.
  const classSheets = useMemo<Sheet[]>(
    () =>
      SECTION_CLASSES.map((classification) => ({
        key: classification || 'none',
        title: classLabel(classification),
        showClass: false,
        entries: standings
          .filter((entry) => (entry.classification || '') === classification)
          .map((entry, index) => ({ ...entry, placing: index + 1 })),
      })).filter((sheet) => sheet.entries.length > 0),
    [standings]
  );

  const printedSheets = useMemo<Sheet[]>(() => {
    if (mode === 'combined') return combinedSheet ? [combinedSheet] : [];
    if (mode === 'classes') return classSheets;
    return classSheets.filter((sheet) => sheet.key === (mode || 'none'));
  }, [mode, combinedSheet, classSheets]);

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
            The results on A4: every class together in one ranking, or a sheet per classification
            with its own 1, 2, 3. The numbers are the standings as they are on screen — printing
            scores nothing of its own.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mb-6 px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="print-mode" className="text-base font-medium text-gray-700">
              Print:
            </label>
            <select
              id="print-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as PrintMode)}
              className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="combined">
                Algemeen klassement — all classes on one sheet ({standings.length})
              </option>
              <option value="classes">Per class — one sheet each</option>
              {classSheets.map((sheet) => (
                <option key={sheet.key} value={sheet.key === 'none' ? '' : sheet.key}>
                  {sheet.title} ({sheet.entries.length})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-base text-gray-700">
              {printedSheets.length} sheet{printedSheets.length === 1 ? '' : 's'} ·{' '}
              {printedSheets.reduce((total, sheet) => total + sheet.entries.length, 0)} crews
            </span>
            <button
              onClick={() => window.print()}
              disabled={printedSheets.length === 0}
              className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-base transition-colors disabled:opacity-50"
            >
              Print
            </button>
          </div>
        </div>

        {error && <p className="text-red-600 font-medium text-base mb-4">{error}</p>}

        {printedSheets.length === 0 && (
          <div className="bg-white rounded-xl shadow border-2 border-gray-200 p-8 text-center">
            <p className="text-lg text-gray-600">
              Nothing to print yet. A crew appears on the standings once they have an answer sheet.
            </p>
          </div>
        )}
      </div>

      {/* The sheets themselves: an A4 page on screen, an A4 page on paper */}
      <div className="mx-auto w-full max-w-[900px] px-4 sm:px-6 print:max-w-none print:px-0">
        {printedSheets.map((sheet) => (
          <section
            key={sheet.key}
            className="standings-sheet bg-white rounded-lg shadow-lg border border-gray-200 p-8 mb-6 print:shadow-none print:rounded-none print:border-0 print:p-0 print:mb-0"
          >
            <header className="flex justify-between items-end border-b-2 border-gray-800 pb-2 mb-3">
              <div>
                <h2 className="text-xl font-bold text-black">
                  {rally.name}
                  {rally.code ? (
                    <span className="ml-2 text-base font-normal">({rally.code})</span>
                  ) : null}
                </h2>
                <p className="text-lg font-semibold text-black">Uitslag — {sheet.title}</p>
              </div>
              <div className="text-right text-xs text-gray-600">
                <p>
                  {sheet.entries.length} equipe{sheet.entries.length === 1 ? '' : 's'}
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
                {sheet.showClass && <col className="w-10" />}
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
                  {sheet.showClass && (
                    <th className="py-1 px-1 text-left text-xs font-bold uppercase tracking-wide">
                      Kl.
                    </th>
                  )}
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
                {sheet.entries.map((entry) => (
                  <tr key={entry.eq} className="border-b border-gray-300">
                    <td className="py-1 pr-1 text-sm font-bold">
                      {entry.placing}
                      {entry.disqualified && (
                        <span className="ml-1 text-xs font-bold" title="Disqualified">
                          DQ
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-1 text-sm font-bold">{entry.eq}</td>
                    {sheet.showClass && (
                      <td className="py-1 px-1 text-sm">{entry.classification || '—'}</td>
                    )}
                    <td className="py-1 px-1 text-sm break-words">
                      {entry.navigatorName || '—'}
                    </td>
                    <td className="py-1 px-1 text-sm break-words">{entry.driverName || '—'}</td>
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
