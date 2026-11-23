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
  // per-stage and per-route columns. A **route** sheet ranks one leg and a
  // **stage** sheet one proef; each prints that part's numbers *as* the crew's
  // totals, so the groups would print the same numbers twice and are left off.
  kind: 'rally' | 'route' | 'stage';
  entries: SheetEntry[];
}

export interface SheetStage {
  _id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Laying a wide sheet out on A4
//
// Four numbers per stage plus four for the rally total is a lot of numbers on
// one line. A rally of a few stages still fits on one A4 landscape page, with
// narrower columns where it has to; a rally of many stages — three days of three
// trajecten — does not, and squeezing it only leaves the crew names a column too
// narrow to print a letter in. That sheet is **split across pages, left to
// right**: every page repeats the place, the EQ, the class and the crew, carries
// as many stages as fit, and the last page ends with the rally total. A rally
// ridden in routes is split on its routes where it can, so a page holds whole
// days; a route too long for one page continues on the next, headed "(vervolg)".
//
// The widths are CSS pixels. The printable width of A4 landscape at the margins
// of `PRINT_STYLES` is 269mm, about 1016px, and the on-screen sheet is laid out
// at the same width, so what an official sees is what comes out of the printer.
// ---------------------------------------------------------------------------

const SHEET_WIDTH = 1000;
const PLACE_WIDTH = 36;
const EQ_WIDTH = 32;
const CLASS_WIDTH = 32;
// The narrowest a crew name column may get before the sheet is split rather
// than squeezed further: room for a surname and a first name on one line.
const NAME_MIN_WIDTH = 128;
const TOTAL_COL_WIDTH = 44;

interface Density {
  col: number;
  body: string;
  head: string;
}

const COMFORTABLE: Density = { col: 36, body: 'text-[9px]', head: 'text-[8px]' };
// Only for a sheet that fits on one page this way and not the other; a sheet
// that is split anyway is split at the comfortable size.
const COMPACT: Density = { col: 28, body: 'text-[8px]', head: 'text-[7px]' };

// One run of stages on one page: a whole route, the part of one that fits, or —
// on a rally with no routes, `group: null` — consecutive stages of the rally.
export interface PageSegment {
  key: string;
  group: RouteGroup<SheetStage> | null;
  stages: SheetStage[];
  // This route was begun on an earlier page; its heading says so.
  continued: boolean;
}

export interface SheetPage {
  segments: PageSegment[];
  // The rally total is printed on the last page only.
  withTotal: boolean;
}

interface Leg {
  group: RouteGroup<SheetStage> | null;
  stages: SheetStage[];
}

// `items` in `parts` runs as even as they come, the longer ones first.
function evenSplit<T>(items: T[], parts: number): T[][] {
  const base = Math.floor(items.length / parts);
  const extra = items.length % parts;
  const runs: T[][] = [];
  let at = 0;
  for (let part = 0; part < parts; part++) {
    const size = base + (part < extra ? 1 : 0);
    runs.push(items.slice(at, at + size));
    at += size;
  }
  return runs;
}

// Which stages go on which page. `capacity` is the width a page has for the
// numbers once the crew columns have had theirs.
//
// A leg goes on the page in hand when it fits there, on a new page when it fits
// on one, and otherwise is spread evenly over as many new pages as it needs. The
// rally total travels with the last leg, so the final page is never a page of
// totals alone.
export function paginateStages(
  legs: Leg[],
  stageWidth: number,
  totalWidth: number,
  capacity: number
): SheetPage[] {
  const pages: SheetPage[] = [];
  let used = 0;
  const perPage = Math.max(1, Math.floor(capacity / stageWidth));
  const filled = legs.filter((leg) => leg.stages.length > 0);

  const openPage = () => {
    pages.push({ segments: [], withTotal: false });
    used = 0;
  };

  filled.forEach((leg, index) => {
    const isLast = index === filled.length - 1;
    const legKey = leg.group?.route?._id ?? `leg-${index}`;
    const width = leg.stages.length * stageWidth + (isLast ? totalWidth : 0);

    const place = (stages: SheetStage[], continued: boolean) => {
      pages[pages.length - 1].segments.push({
        key: `${legKey}-${stages[0]._id}`,
        group: leg.group,
        stages,
        continued,
      });
      used += stages.length * stageWidth;
    };

    if (pages.length > 0 && used + width <= capacity) {
      place(leg.stages, false);
    } else if (width <= capacity) {
      openPage();
      place(leg.stages, false);
    } else {
      let parts = Math.ceil(leg.stages.length / perPage);
      let runs = evenSplit(leg.stages, parts);
      // The last run of the last leg also carries the total.
      while (
        isLast &&
        parts < leg.stages.length &&
        runs[runs.length - 1].length * stageWidth + totalWidth > capacity
      ) {
        parts += 1;
        runs = evenSplit(leg.stages, parts);
      }
      runs.forEach((run, part) => {
        openPage();
        place(run, part > 0);
      });
    }
  });

  if (pages.length === 0) pages.push({ segments: [], withTotal: true });
  else pages[pages.length - 1].withTotal = true;
  return pages;
}

interface SheetLayout {
  density: Density;
  pages: SheetPage[];
  nameWidth: number;
}

// One page when the sheet fits on one — at the comfortable size, else the
// compact one — and otherwise as many pages as `paginateStages` needs. The crew
// names get the same width on every page, so a row is as tall on page 2 as on
// page 1 and the rows of one crew line up when the pages lie side by side; what
// a page has left over widens its numbers instead.
function layoutSheet(legs: Leg[], fixedWidth: number): SheetLayout {
  const capacity = SHEET_WIDTH - fixedWidth - 2 * NAME_MIN_WIDTH;
  const totalWidth = 4 * TOTAL_COL_WIDTH;
  const stageCount = legs.reduce((count, leg) => count + leg.stages.length, 0);
  const nameRoom = (numbers: number) =>
    Math.floor((SHEET_WIDTH - fixedWidth - numbers) / 2);

  for (const density of [COMFORTABLE, COMPACT]) {
    const numbers = stageCount * 4 * density.col + totalWidth;
    if (numbers <= capacity) {
      return {
        density,
        pages: [
          {
            segments: legs
              .filter((leg) => leg.stages.length > 0)
              .map((leg, index) => ({
                key: leg.group?.route?._id ?? `leg-${index}`,
                group: leg.group,
                stages: leg.stages,
                continued: false,
              })),
            withTotal: true,
          },
        ],
        nameWidth: nameRoom(numbers),
      };
    }
  }

  const stageWidth = 4 * COMFORTABLE.col;
  const pages = paginateStages(legs, stageWidth, totalWidth, capacity);
  const widest = Math.max(
    ...pages.map(
      (page) =>
        page.segments.reduce((sum, segment) => sum + segment.stages.length, 0) * stageWidth +
        (page.withTotal ? totalWidth : 0)
    )
  );
  return { density: COMFORTABLE, pages, nameWidth: nameRoom(widest) };
}

// How many columns one leg contributes on a page: four per stage of it. The
// `<colgroup>`, the three header rows and the body all have to agree on this — a
// header row that does not add up is what shears a printed table sideways — so
// the route heading's span reads it from here rather than restating it.
const segmentColumns = (segment: { stages: unknown[] }) => 4 * segment.stages.length;

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

    /* A sheet too wide for one page goes on over the next ones, each page of
       it starting on a fresh sheet of paper. */
    .standings-page + .standings-page {
      break-before: page;
      page-break-before: always;
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
  announcer = false,
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
  // The **announcer's list**: the place, the EQ, the crew and the four rally
  // totals, nothing else — no per-stage or per-route columns and no class
  // column — set large enough to be read out loud. The same crews in the same
  // order with the same numbers; only what is printed of them is less.
  announcer?: boolean;
}) {
  // A **route** or **stage** sheet prints one part's numbers *as* the crew's
  // totals, so it never carries the groups — they would print the same numbers
  // twice. Only the rally sheets group, and never on the announcer's list.
  const showClass = sheet.showClass && !announcer;
  const sheetGroupsByRoute = !announcer && showRoutes && sheet.kind === 'rally';
  const sheetGroupsByStage =
    !announcer && !sheetGroupsByRoute && showStages && sheet.kind === 'rally';
  const grouped = sheetGroupsByRoute || sheetGroupsByStage;

  const fixedWidth = PLACE_WIDTH + EQ_WIDTH + (showClass ? CLASS_WIDTH : 0);
  const layout: SheetLayout | null = grouped
    ? layoutSheet(
        sheetGroupsByRoute
          ? routeGroups.map((group) => ({ group, stages: group.stages }))
          : [{ group: null, stages }],
        fixedWidth
      )
    : null;
  const pages: SheetPage[] = layout ? layout.pages : [{ segments: [], withTotal: true }];
  const density = layout?.density ?? COMFORTABLE;

  // The plain sheet's type sizes. The announcer's list is read out loud from
  // the paper in hand, so it is set a size up — it has the room, with five
  // columns fewer than the smallest result sheet.
  const headText = announcer ? 'text-xs' : 'text-[10px]';
  const bodyText = announcer ? 'text-base' : 'text-xs';
  const nameText = announcer ? 'text-base' : 'text-[0.65rem]/[0.85rem]';
  const cellY = announcer ? 'py-1' : 'py-0.5';

  // The fixed left-hand columns span every header row above the numbers,
  // so their label sits beside the sub-headings of the groups rather
  // than above them. Three rows on a routed sheet (route → stage → the
  // numbers), two on the per-stage sheet, one on the plain one.
  const headSpan = sheetGroupsByRoute ? 3 : sheetGroupsByStage ? 2 : 1;
  const fixedHeaders = (
    <>
      <th
        rowSpan={headSpan}
        className={`py-0.5 pr-1 text-left align-bottom ${headText} font-bold uppercase tracking-wide`}
      >
        #
      </th>
      <th
        rowSpan={headSpan}
        className={`py-0.5 px-1 text-left align-bottom ${headText} font-bold uppercase tracking-wide`}
      >
        EQ
      </th>
      {showClass && (
        <th
          rowSpan={headSpan}
          className={`py-0.5 px-1 text-left align-bottom ${headText} font-bold uppercase tracking-wide`}
        >
          Kl.
        </th>
      )}
      <th
        rowSpan={headSpan}
        className={`py-0.5 px-1 text-left align-bottom ${headText} font-bold uppercase tracking-wide`}
      >
        Navigator
      </th>
      <th
        rowSpan={headSpan}
        className={`py-0.5 px-1 text-left align-bottom ${headText} font-bold uppercase tracking-wide`}
      >
        Bestuurder
      </th>
    </>
  );

  // The rally total, at the right-hand end of the (last page of the) sheet:
  // the per-stage numbers added up when the sheet shows them, and the only
  // numbers on the sheet when it does not.
  const totalHeaders = (
    <>
      {/* On a routed sheet every group above reads ORC, so the rally
          total does too — the same reason its last column reads Tot.
          rather than Totaal. */}
      <th
        className={`py-0.5 px-1 text-right align-bottom ${headText} font-bold uppercase tracking-wide${
          grouped ? ' border-l-2 border-gray-800' : ''
        }`}
      >
        {sheetGroupsByRoute ? 'ORC' : <>ORC&apos;s</>}
      </th>
      <th className={`py-0.5 px-1 text-right align-bottom ${headText} font-bold uppercase tracking-wide`}>
        Tijd
      </th>
      <th
        className={`py-0.5 px-1 text-right align-bottom ${headText} font-bold uppercase tracking-wide`}
        title="The merk column of every sheet"
      >
        Div.
      </th>
      <th className={`py-0.5 pl-1 text-right align-bottom ${headText} font-bold uppercase tracking-wide`}>
        {sheetGroupsByRoute ? 'Tot.' : 'Totaal'}
      </th>
    </>
  );

  // The four numbers of one stage, headed. On a routed sheet the first stage
  // of a route opens it with the heavy rule.
  const stageNumberHeaders = (stage: SheetStage, edge: string) => (
    <React.Fragment key={stage._id}>
      <th
        className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${edge} ${density.head}`}
      >
        ORC
      </th>
      <th className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${density.head}`}>
        Tijd
      </th>
      <th className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${density.head}`}>
        Div.
      </th>
      <th className={`py-0.5 px-0.5 text-right align-bottom font-bold uppercase ${density.head}`}>
        {sheetGroupsByRoute ? 'Tot.' : 'Sub'}
      </th>
    </React.Fragment>
  );

  const stageEdge = (index: number) =>
    sheetGroupsByRoute && index === 0 ? 'border-l-2 border-gray-800' : 'border-l border-gray-500';

  // No sheet for a stage is not a zero: the standings score the crew on it as a
  // blank card, so the numbers are printed like any other and the subtotal
  // carries a * saying where they came from.
  const stageCells = (entry: SheetEntry, stage: SheetStage, edge: string) => {
    const score = entry.stagePenalties?.[stage._id];
    const cell = `py-0.5 px-0.5 text-right tabular-nums ${density.body}`;

    return (
      <React.Fragment key={stage._id}>
        <td className={`${cell} ${edge}`}>{score ? score.orcPenalty : ''}</td>
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
  };

  const numberCol = announcer ? 'w-20' : 'w-12';

  const renderTable = (page: SheetPage) => {
    const pageStages = page.segments.flatMap((segment) => segment.stages);

    // Explicit widths on a grouped sheet: the crew names the same on every
    // page, and what is left over on this page spread over its numbers.
    let widths: { stage: number; total: number; table: number; name: number } | null = null;
    if (layout) {
      const numbers = pageStages.length * 4 + (page.withTotal ? 4 : 0);
      const base =
        pageStages.length * 4 * density.col + (page.withTotal ? 4 * TOTAL_COL_WIDTH : 0);
      const spare = Math.max(0, SHEET_WIDTH - fixedWidth - 2 * layout.nameWidth - base);
      const extra = numbers > 0 ? Math.floor(spare / numbers) : 0;
      const stage = density.col + extra;
      const total = TOTAL_COL_WIDTH + extra;
      widths = {
        stage,
        total,
        name: layout.nameWidth,
        table:
          fixedWidth +
          2 * layout.nameWidth +
          pageStages.length * 4 * stage +
          (page.withTotal ? 4 * total : 0),
      };
    }

    return (
      <table
        className={`table-fixed border-collapse text-black${widths ? '' : ' w-full'}`}
        style={widths ? { width: widths.table } : undefined}
      >
        {/* The numbers get exactly the room their digits need; what is
            left is the crew's, because a name that does not fit is the
            one thing on this sheet that cannot be abbreviated. A long
            name wraps onto a second line rather than being cut off. */}
        {widths ? (
          <colgroup>
            <col style={{ width: PLACE_WIDTH }} />
            <col style={{ width: EQ_WIDTH }} />
            {showClass && <col style={{ width: CLASS_WIDTH }} />}
            <col style={{ width: widths.name }} />
            <col style={{ width: widths.name }} />
            {pageStages.map((stage) => (
              <React.Fragment key={stage._id}>
                <col style={{ width: widths.stage }} />
                <col style={{ width: widths.stage }} />
                <col style={{ width: widths.stage }} />
                <col style={{ width: widths.stage }} />
              </React.Fragment>
            ))}
            {page.withTotal && (
              <>
                <col style={{ width: widths.total }} />
                <col style={{ width: widths.total }} />
                <col style={{ width: widths.total }} />
                <col style={{ width: widths.total }} />
              </>
            )}
          </colgroup>
        ) : (
          <colgroup>
            <col className={announcer ? 'w-14' : 'w-11'} />
            <col className={announcer ? 'w-14' : 'w-10'} />
            {showClass && <col className="w-10" />}
            <col />
            <col />
            <col className={numberCol} />
            <col className={numberCol} />
            <col className={numberCol} />
            <col className={numberCol} />
          </colgroup>
        )}
        <thead>
          {sheetGroupsByRoute ? (
            <>
              {/* One heading per leg, over the stages of it on this page. */}
              <tr>
                {fixedHeaders}
                {page.segments.map((segment) => (
                  <th
                    key={segment.key}
                    colSpan={segmentColumns(segment)}
                    className={`py-0.5 px-1 text-center font-bold uppercase tracking-wide break-words border-l-2 border-gray-800 ${density.head}`}
                  >
                    {segment.group?.position}.{' '}
                    {segment.group?.route ? segment.group.route.name : 'Zonder route'}
                    {segment.continued ? ' (vervolg)' : ''}
                  </th>
                ))}
                {page.withTotal && (
                  <th
                    colSpan={4}
                    rowSpan={headSpan - 1}
                    className={`py-0.5 px-1 text-center align-bottom font-bold uppercase tracking-wide border-l-2 border-gray-800 ${density.head}`}
                  >
                    Eindtotaal
                  </th>
                )}
              </tr>
              {/* The stages of each leg, each over the four it cost */}
              <tr>
                {page.segments.flatMap((segment) =>
                  segment.stages.map((stage, index) => (
                    <th
                      key={stage._id}
                      colSpan={4}
                      className={`py-0.5 px-1 text-center font-bold uppercase tracking-wide break-words ${stageEdge(
                        index
                      )} ${density.head}`}
                    >
                      {stage.name}
                    </th>
                  ))
                )}
              </tr>
              <tr className="border-b-2 border-gray-800">
                {page.segments.flatMap((segment) =>
                  segment.stages.map((stage, index) => stageNumberHeaders(stage, stageEdge(index)))
                )}
                {page.withTotal && totalHeaders}
              </tr>
            </>
          ) : sheetGroupsByStage ? (
            <>
              {/* One heading per stage, over the four numbers it cost */}
              <tr>
                {fixedHeaders}
                {pageStages.map((stage) => (
                  <th
                    key={stage._id}
                    colSpan={4}
                    className={`py-0.5 px-1 text-center font-bold uppercase tracking-wide break-words border-l border-gray-500 ${density.head}`}
                  >
                    {stage.name}
                  </th>
                ))}
                {page.withTotal && (
                  <th
                    colSpan={4}
                    className={`py-0.5 px-1 text-center font-bold uppercase tracking-wide border-l-2 border-gray-800 ${density.head}`}
                  >
                    Eindtotaal
                  </th>
                )}
              </tr>
              <tr className="border-b-2 border-gray-800">
                {pageStages.map((stage) => stageNumberHeaders(stage, 'border-l border-gray-500'))}
                {page.withTotal && totalHeaders}
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
              <td className={`${cellY} pr-1 ${bodyText} font-bold`}>
                {isRanked(entry.status) ? entry.placing : STATUS_LABEL[entry.status]}
              </td>
              <td className={`${cellY} px-1 ${bodyText} font-bold`}>{entry.eq}</td>
              {showClass && (
                <td className={`${cellY} px-1 ${bodyText}`}>{entry.classification || '—'}</td>
              )}
              {/* The crew names run a shade smaller than the rest of
                  the row: they are the widest thing on the sheet and
                  the only one that wraps, so the size they are set at
                  is what decides how many crews fit on a page. */}
              <td className={`${cellY} px-1 ${nameText} break-words`}>
                {entry.navigatorName || '—'}
              </td>
              <td className={`${cellY} px-1 ${nameText} break-words`}>
                {entry.driverName || '—'}
              </td>
              {sheetGroupsByRoute &&
                page.segments.flatMap((segment) =>
                  segment.stages.map((stage, index) => stageCells(entry, stage, stageEdge(index)))
                )}
              {sheetGroupsByStage &&
                pageStages.map((stage) => stageCells(entry, stage, 'border-l border-gray-500'))}
              {page.withTotal && (
                <>
                  <td
                    className={`${cellY} px-1 ${bodyText} text-right tabular-nums${
                      grouped ? ' border-l-2 border-gray-800' : ''
                    }`}
                  >
                    {entry.orcPenalty}
                  </td>
                  <td className={`${cellY} px-1 ${bodyText} text-right tabular-nums`}>
                    {entry.timePenalty}
                  </td>
                  <td className={`${cellY} px-1 ${bodyText} text-right tabular-nums`}>
                    {entry.merkPenalty}
                  </td>
                  <td className={`${cellY} pl-1 ${bodyText} text-right font-bold tabular-nums`}>
                    {entry.totalPenalty}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <section key={sheet.key} className="standings-sheet">
      {pages.map((page, pageIndex) => {
        const pageStages = page.segments.flatMap((segment) => segment.stages);

        return (
          <div
            key={pageIndex}
            className="standings-page bg-white rounded-lg shadow-lg border border-gray-200 p-8 mb-6 print:shadow-none print:rounded-none print:border-0 print:p-0 print:mb-0"
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
                {sheet.subtitle && <p className="text-xs text-black">{sheet.subtitle}</p>}
              </div>
              <div className="text-right text-xs text-gray-600">
                {pages.length > 1 && (
                  <p className="font-semibold text-black">
                    Blad {pageIndex + 1} van {pages.length}
                  </p>
                )}
                <p>
                  {sheet.entries.length} equipe{sheet.entries.length === 1 ? '' : 's'}
                </p>
                <p>{printedOn}</p>
              </div>
            </header>

            {/* Scrolls on a narrow screen; on paper the sheet is laid out at
                the page's own width. */}
            <div className="overflow-x-auto print:overflow-visible">{renderTable(page)}</div>

            {/* Only when a crew on *this* page is short of a card: the * has
                to be explained where it is printed, and nowhere else. */}
            {grouped &&
              sheet.entries.some((entry) =>
                pageStages.some((stage) => entry.stagePenalties?.[stage._id]?.missingSheet)
              ) && (
                <p className="mt-1 text-[0.6rem] text-gray-700">
                  * Geen ingeleverde kaart voor die proef — geteld als blanco kaart.
                </p>
              )}

            {/* On a route or stage sheet: what a place, a DNF and a DNS mean
                for one part of the rally, which is not what they mean for
                the rally. */}
            {sheet.kind === 'route' &&
              sheet.entries.some((entry) => !isRanked(entry.status)) && (
                <p className="mt-1 text-[0.6rem] text-gray-700">
                  DNF — geen ingeleverde kaart voor de laatste proef van deze route. DNS —
                  geen enkele kaart op deze route.
                </p>
              )}
            {sheet.kind === 'stage' &&
              sheet.entries.some((entry) => !isRanked(entry.status)) && (
                <p className="mt-1 text-[0.6rem] text-gray-700">
                  DNF — buiten het finishvenster van de laatste proef, of geen finishtijd. DNS —
                  geen ingeleverde kaart voor deze proef, geteld als blanco kaart.
                </p>
              )}
          </div>
        );
      })}
    </section>
  );
}
