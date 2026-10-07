'use client';

import React from 'react';

import { isRanked, STATUS_LABEL, type StandingsStatus } from '../lib/standings';
import type { RouteGroup } from '../lib/routes';
import type { ClassificationValue } from '../lib/participants';

// One result sheet on A4 landscape: the heading, the table of crews and the
// footnotes under it. Shared by the officials' print page
// (/rallies/[id]/standings/print), which decides *which* sheets are printed,
// and by the public results page (/public/rallies/[id]), whose Download PDF
// prints the same Algemeen klassement — so the paper a crew saves from their
// phone and the one on the wall at the finish are one rendering.
//
// It scores nothing and ranks nothing: a sheet arrives with its crews in order
// and with the place each takes on it (`placing`).

// What a crew scored on one stage — the three parts of that one sheet and its
// own total, or what a blank card costs when they have no sheet for it
// (`missingSheet`).
export interface SheetStageScore {
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  missingSheet?: boolean;
}

// A crew on a sheet: the totals it is printed with, plus the place it takes
// *on that sheet* — the rally rank on the combined sheet, the place within the
// class on a class sheet, the place within A and H together on the
// wedstrijdklasse.
export interface SheetEntry {
  eq: number;
  status: StandingsStatus;
  classification: ClassificationValue | '';
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  // Keyed by stage id. A stage the crew has no score for is simply absent.
  stagePenalties?: Record<string, SheetStageScore>;
  placing: number;
}

export interface Sheet {
  key: string;
  title: string;
  // Under the title, on a sheet that ranks part of the rally: what these numbers
  // are, so nobody adds a route sheet to the rally sheet.
  subtitle?: string;
  // The combined sheet mixes the classes, so it names the class of every crew;
  // a class sheet has it in the heading already.
  showClass: boolean;
  // A **rally** sheet ranks the whole rally and can therefore carry the
  // per-stage and per-route columns. A **route** sheet ranks one leg and prints
  // that leg's numbers *as* the crew's totals, so the groups would print the
  // same numbers twice and are left off.
  kind: 'rally' | 'route';
  entries: SheetEntry[];
}

export interface SheetStage {
  _id: string;
  name: string;
}

// Four columns per stage plus four for the rally total is a lot of numbers on
// one line, and the sheet has one A4 landscape page to put them on. A rally
// with more stages therefore gets narrower, smaller per-stage columns rather
// than a stage left off the sheet — the crew names keep whatever is left, and a
// name that still does not fit wraps as it always did.
const stageSizing = (stageCount: number) => {
  if (stageCount >= 7) return { col: 'w-6', body: 'text-[8px]', head: 'text-[7px]' };
  if (stageCount >= 5) return { col: 'w-7', body: 'text-[9px]', head: 'text-[8px]' };
  if (stageCount >= 3) return { col: 'w-8', body: 'text-[10px]', head: 'text-[9px]' };
  return { col: 'w-10', body: 'text-[10px]', head: 'text-[10px]' };
};

// A routed sheet is the per-stage sheet with the legs written over it: the
// ORC's, Tijd, Diversen and subtotal per stage, the stages grouped under the
// route they are ridden in, and the rally total behind them.
//
// **It carries no route subtotal.** A leg's total is its stages added up, and an
// official reading the sheet wants the proeven; the leg's own number is what the
// per-route ranking sheets are for, where it is the thing being ranked. Leaving
// it off is also what keeps the sheet the same width as the per-stage sheet —
// `4 x stages + 4` numeric columns either way — so `stageSizing` sizes both and
// the routes cost one header row rather than a column.
//
// How many columns one leg contributes: four per stage of it. The `<colgroup>`,
// the three header rows and the body all have to agree on this — a header row
// that does not add up is what shears a printed table sideways — so the route
// heading's span reads it from here rather than restating the arithmetic.
const routeColumns = (group: { stages: unknown[] }) => 4 * group.stages.length;

// Print rules that Tailwind has no utility for: the paper size itself, the page
// break between two sheets and the header row that repeats when a sheet runs
// over one page. A page that prints these sheets renders this in a `<style>` of
// its own rather than in globals.css — the QR sheet prints its cards on the
// browser's own default page and should stay that way.
export const PRINT_STYLES = `
  @media print {
    @page {
      /* Landscape, always: the result sheet is a wide table — the place, the
         EQ, the class, two names and four numbers — and the names are what
         runs out of room first on a portrait page. */
      size: A4 landscape;
      margin: 12mm 14mm;
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

// The moment the sheets were put on paper, printed in each sheet's corner.
export const formatPrintedOn = (date: Date) =>
  date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function StandingsSheet({
  rally,
  sheet,
  stages,
  routeGroups,
  showStages,
  showRoutes,
  printedOn,
}: {
  rally: { name: string; code?: string };
  sheet: Sheet;
  // The rally's stages in running order.
  stages: SheetStage[];
  // The rally's legs; empty on a rally with no routes.
  routeGroups: RouteGroup<SheetStage>[];
  // Per-stage columns (a rally of more than one stage, no legs to group by)…
  showStages: boolean;
  // …or the same columns grouped under the route each stage is ridden in.
  showRoutes: boolean;
  printedOn: string;
}) {
  const sizing = stageSizing(stages.length);

  // A **route** sheet prints one leg's numbers *as* the crew's totals,
  // so it never carries the groups — they would print the same numbers
  // twice. Only the rally sheets group.
  const sheetGroupsByRoute = showRoutes && sheet.kind === 'rally';
  const sheetGroupsByStage = showStages && sheet.kind === 'rally';

  // The fixed left-hand columns span every header row above the numbers,
  // so their label sits beside the sub-headings of the groups rather
  // than above them. Three rows on a routed sheet (route → stage → the
  // numbers), two on the per-stage sheet, one on the plain one.
  const headSpan = sheetGroupsByRoute ? 3 : sheetGroupsByStage ? 2 : 1;
  const fixedHeaders = (
    <>
      <th
        rowSpan={headSpan}
        className="py-0.5 pr-1 text-left align-bottom text-[10px] font-bold uppercase tracking-wide"
      >
        #
      </th>
      <th
        rowSpan={headSpan}
        className="py-0.5 px-1 text-left align-bottom text-[10px] font-bold uppercase tracking-wide"
      >
        EQ
      </th>
      {sheet.showClass && (
        <th
          rowSpan={headSpan}
          className="py-0.5 px-1 text-left align-bottom text-[10px] font-bold uppercase tracking-wide"
        >
          Kl.
        </th>
      )}
      <th
        rowSpan={headSpan}
        className="py-0.5 px-1 text-left align-bottom text-[10px] font-bold uppercase tracking-wide"
      >
        Navigator
      </th>
      <th
        rowSpan={headSpan}
        className="py-0.5 px-1 text-left align-bottom text-[10px] font-bold uppercase tracking-wide"
      >
        Bestuurder
      </th>
    </>
  );

  // The rally total, at the right-hand end of every sheet: the
  // per-stage numbers added up when the sheet shows them, and the only
  // numbers on the sheet when it does not.
  const totalHeaders = (
    <>
      {/* On a routed sheet every group above reads ORC, so the rally
          total does too — the same reason its last column reads Tot.
          rather than Totaal. */}
      <th
        className={`py-0.5 px-1 text-right align-bottom text-[10px] font-bold uppercase tracking-wide${
          sheetGroupsByStage || sheetGroupsByRoute ? ' border-l-2 border-gray-800' : ''
        }`}
      >
        {sheetGroupsByRoute ? 'ORC' : <>ORC&apos;s</>}
      </th>
      <th className="py-0.5 px-1 text-right align-bottom text-[10px] font-bold uppercase tracking-wide">
        Tijd
      </th>
      <th
        className="py-0.5 px-1 text-right align-bottom text-[10px] font-bold uppercase tracking-wide"
        title="The merk column of every sheet"
      >
        Div.
      </th>
      {/* On a routed sheet every other group ends in "Tot.", so the
          rally total does too — three levels of the same four numbers
          read better with one word for the last of them. */}
      <th className="py-0.5 pl-1 text-right align-bottom text-[10px] font-bold uppercase tracking-wide">
        {sheetGroupsByRoute ? 'Tot.' : 'Totaal'}
      </th>
    </>
  );

  return (
    <section
      key={sheet.key}
      className="standings-sheet bg-white rounded-lg shadow-lg border border-gray-200 p-8 mb-6 print:shadow-none print:rounded-none print:border-0 print:p-0 print:mb-0"
    >
      <header className="flex justify-between items-end border-b-2 border-gray-800 pb-2 mb-3">
        <div>
          <h2 className="text-lg font-bold text-black">
            {rally.name}
            {rally.code ? (
              <span className="ml-2 text-base font-normal">({rally.code})</span>
            ) : null}
          </h2>
          <p className="text-base font-semibold text-black">Uitslag — {sheet.title}</p>
          {sheet.subtitle && (
            <p className="text-xs text-black">{sheet.subtitle}</p>
          )}
        </div>
        <div className="text-right text-xs text-gray-600">
          <p>
            {sheet.entries.length} equipe{sheet.entries.length === 1 ? '' : 's'}
          </p>
          <p>{printedOn}</p>
        </div>
      </header>

      <table className="w-full table-fixed border-collapse text-black">
        {/* The numbers get exactly the room their digits need; what is
            left is the crew's, because a name that does not fit is the
            one thing on this sheet that cannot be abbreviated. A long
            name wraps onto a second line rather than being cut off. */}
        <colgroup>
          <col className={sheetGroupsByStage || sheetGroupsByRoute ? 'w-9' : 'w-11'} />
          <col className={sheetGroupsByStage || sheetGroupsByRoute ? 'w-8' : 'w-10'} />
          {sheet.showClass && (
            <col className={sheetGroupsByStage || sheetGroupsByRoute ? 'w-8' : 'w-10'} />
          )}
          <col />
          <col />
          {sheetGroupsByStage &&
            stages.map((stage) => (
              <React.Fragment key={stage._id}>
                <col className={sizing.col} />
                <col className={sizing.col} />
                <col className={sizing.col} />
                <col className={sizing.col} />
              </React.Fragment>
            ))}
          {/* Per route: the four numbers per stage of it. Same widths
              as the per-stage sheet — the routes cost a header row, not
              a column. */}
          {sheetGroupsByRoute &&
            routeGroups.map((group) => (
              <React.Fragment key={group.route?._id || group.position}>
                {group.stages.map((stage) => (
                  <React.Fragment key={stage._id}>
                    <col className={sizing.col} />
                    <col className={sizing.col} />
                    <col className={sizing.col} />
                    <col className={sizing.col} />
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          <col className="w-12" />
          <col className="w-12" />
          <col className="w-12" />
          <col className="w-12" />
        </colgroup>
        <thead>
          {sheetGroupsByRoute ? (
            <>
              {/* One heading per leg, over the stages ridden in it. */}
              <tr>
                {fixedHeaders}
                {routeGroups.map((group, index) => (
                  <th
                    key={group.route?._id || group.position}
                    colSpan={routeColumns(group)}
                    className={`py-0.5 px-1 text-center font-bold uppercase tracking-wide break-words border-l-2 border-gray-800 ${sizing.head}`}
                  >
                    {index + 1}. {group.route ? group.route.name : 'Zonder route'}
                  </th>
                ))}
                <th
                  colSpan={4}
                  rowSpan={headSpan - 1}
                  className={`py-0.5 px-1 text-center align-bottom font-bold uppercase tracking-wide border-l-2 border-gray-800 ${sizing.head}`}
                >
                  Eindtotaal
                </th>
              </tr>
              {/* The stages of each leg, each over the four it cost */}
              <tr>
                {routeGroups.flatMap((group) =>
                  group.stages.map((stage, index) => (
                    <th
                      key={stage._id}
                      colSpan={4}
                      className={`py-0.5 px-1 text-center font-bold uppercase tracking-wide break-words ${
                        index === 0
                          ? 'border-l-2 border-gray-800'
                          : 'border-l border-gray-500'
                      } ${sizing.head}`}
                    >
                      {stage.name}
                    </th>
                  ))
                )}
              </tr>
              <tr className="border-b-2 border-gray-800">
                {routeGroups.flatMap((group) =>
                  group.stages.map((stage, index) => (
                    <React.Fragment key={stage._id}>
                      <th
                        className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${
                          index === 0
                            ? 'border-l-2 border-gray-800'
                            : 'border-l border-gray-500'
                        } ${sizing.head}`}
                      >
                        ORC
                      </th>
                      <th
                        className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${sizing.head}`}
                      >
                        Tijd
                      </th>
                      <th
                        className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${sizing.head}`}
                      >
                        Div.
                      </th>
                      <th
                        className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${sizing.head}`}
                      >
                        Tot.
                      </th>
                    </React.Fragment>
                  ))
                )}
                {totalHeaders}
              </tr>
            </>
          ) : sheetGroupsByStage ? (
            <>
              {/* One heading per stage, over the four numbers it cost */}
              <tr>
                {fixedHeaders}
                {stages.map((stage) => (
                  <th
                    key={stage._id}
                    colSpan={4}
                    className={`py-0.5 px-1 text-center font-bold uppercase tracking-wide break-words border-l border-gray-500 ${sizing.head}`}
                  >
                    {stage.name}
                  </th>
                ))}
                <th
                  colSpan={4}
                  className={`py-0.5 px-1 text-center font-bold uppercase tracking-wide border-l-2 border-gray-800 ${sizing.head}`}
                >
                  Eindtotaal
                </th>
              </tr>
              <tr className="border-b-2 border-gray-800">
                {stages.map((stage) => (
                  <React.Fragment key={stage._id}>
                    <th
                      className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase border-l border-gray-500 ${sizing.head}`}
                    >
                      ORC
                    </th>
                    <th
                      className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${sizing.head}`}
                    >
                      Tijd
                    </th>
                    <th
                      className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${sizing.head}`}
                    >
                      Div.
                    </th>
                    <th
                      className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${sizing.head}`}
                    >
                      Sub
                    </th>
                  </React.Fragment>
                ))}
                {totalHeaders}
              </tr>
            </>
          ) : (
            <tr className="border-b-2 border-gray-800">
              {fixedHeaders}
              {totalHeaders}
            </tr>
          )}
        </thead>
        <tbody>
          {sheet.entries.map((entry) => (
            <tr key={entry.eq} className="border-b border-gray-300">
              {/* A crew who did not finish, and one who never started,
                  have no place in the result: they are behind the field
                  because the standings have to put them somewhere, not
                  because they came 32nd. The sheet says what happened
                  instead — DNF or DNS. */}
              <td className="py-0.5 pr-1 text-xs font-bold">
                {isRanked(entry.status) ? entry.placing : STATUS_LABEL[entry.status]}
              </td>
              <td className="py-0.5 px-1 text-xs font-bold">{entry.eq}</td>
              {sheet.showClass && (
                <td className="py-0.5 px-1 text-xs">{entry.classification || '—'}</td>
              )}
              {/* The crew names run a shade smaller than the rest of
                  the row: they are the widest thing on the sheet and
                  the only one that wraps, so the size they are set at
                  is what decides how many crews fit on a page. */}
              <td className="py-0.5 px-1 text-[0.65rem]/[0.85rem] break-words">
                {entry.navigatorName || '—'}
              </td>
              <td className="py-0.5 px-1 text-[0.65rem]/[0.85rem] break-words">
                {entry.driverName || '—'}
              </td>
              {sheetGroupsByRoute &&
                routeGroups.flatMap((group) =>
                  group.stages.map((stage, index) => {
                    // No card for a stage is not a zero: the standings
                    // score the crew on it as a blank card, and the *
                    // says where the number came from.
                    const score = entry.stagePenalties?.[stage._id];
                    const cell = `py-0.5 px-0.5 text-right tabular-nums ${sizing.body}`;
                    const edge =
                      index === 0
                        ? 'border-l-2 border-gray-800'
                        : 'border-l border-gray-500';

                    return (
                      <React.Fragment key={stage._id}>
                        <td className={`${cell} ${edge}`}>
                          {score ? score.orcPenalty : ''}
                        </td>
                        <td className={cell}>{score ? score.timePenalty : ''}</td>
                        <td className={cell}>{score ? score.merkPenalty : ''}</td>
                        <td className={`${cell} font-semibold`}>
                          {score ? (
                            <>
                              {score.totalPenalty}
                              {score.missingSheet ? '*' : ''}
                            </>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                      </React.Fragment>
                    );
                  })
                )}
              {sheetGroupsByStage &&
                stages.map((stage) => {
                  // No sheet for this stage is not a zero: the
                  // standings score the crew on it as a blank card, so
                  // the numbers are printed like any other and the
                  // sub-total carries a * saying where they came from.
                  const score = entry.stagePenalties?.[stage._id];
                  const cell = `py-0.5 px-0.5 text-right tabular-nums ${sizing.body}`;

                  return (
                    <React.Fragment key={stage._id}>
                      <td className={`${cell} border-l border-gray-500`}>
                        {score ? score.orcPenalty : ''}
                      </td>
                      <td className={cell}>{score ? score.timePenalty : ''}</td>
                      <td className={cell}>{score ? score.merkPenalty : ''}</td>
                      <td className={`${cell} font-semibold`}>
                        {score ? (
                          <>
                            {score.totalPenalty}
                            {score.missingSheet ? '*' : ''}
                          </>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </React.Fragment>
                  );
                })}
              <td
                className={`py-0.5 px-1 text-xs text-right tabular-nums${
                  sheetGroupsByStage || sheetGroupsByRoute
                    ? ' border-l-2 border-gray-800'
                    : ''
                }`}
              >
                {entry.orcPenalty}
              </td>
              <td className="py-0.5 px-1 text-xs text-right tabular-nums">
                {entry.timePenalty}
              </td>
              <td className="py-0.5 px-1 text-xs text-right tabular-nums">
                {entry.merkPenalty}
              </td>
              <td className="py-0.5 pl-1 text-xs text-right font-bold tabular-nums">
                {entry.totalPenalty}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Only when a crew on *this* sheet is short of a card: the * has
          to be explained where it is printed, and nowhere else. */}
      {(sheetGroupsByStage || sheetGroupsByRoute) &&
        sheet.entries.some((entry) =>
          stages.some((stage) => entry.stagePenalties?.[stage._id]?.missingSheet)
        ) && (
          <p className="mt-1 text-[0.6rem] text-gray-700">
            * Geen ingeleverde kaart voor die proef — geteld als blanco kaart.
          </p>
        )}

      {/* On a route sheet: what a place, a DNF and a DNS mean for one
          leg, which is not what they mean for the rally. */}
      {sheet.kind === 'route' &&
        sheet.entries.some((entry) => !isRanked(entry.status)) && (
          <p className="mt-1 text-[0.6rem] text-gray-700">
            DNF — geen ingeleverde kaart voor de laatste proef van deze route. DNS —
            geen enkele kaart op deze route.
          </p>
        )}
    </section>
  );
}
