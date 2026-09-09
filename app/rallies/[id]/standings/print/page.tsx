'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  isRanked,
  STATUS_LABEL,
  STATUS_ORDER,
  type StandingsStatus,
} from '../../../../lib/standings';
import {
  groupStagesByRoute,
  routeTotals,
  type RouteScore,
} from '../../../../lib/routes';
import {
  CLASSIFICATIONS,
  WEDSTRIJDKLASSE_CLASSES,
  WEDSTRIJDKLASSE_LABEL,
  inWedstrijdklasse,
  type ClassificationValue,
} from '../../../../lib/participants';

// The standings on paper.
//
// The dashboard's standings tab is one long table of the whole field, which is
// what an official reads on a screen. What goes on the wall at the finish is a
// result sheet, and there are four of those — the last only on a rally that is
// ridden in routes:
//
//   * **Per klasse** — one A4 per classification, each with its own 1, 2, 3,
//     because a class rides against its own class.
//   * **Wedstrijdklasse** — the classes that ride one competition
//     (`WEDSTRIJDKLASSE_CLASSES`: A and H) ranked together on one sheet, with
//     its own 1, 2, 3. A crew of those classes is therefore printed twice — on
//     their own class sheet and on this one — because they are placed in both.
//   * **Algemeen klassement** — every class together in one ranking, the whole
//     field on one sheet. It is the same order the dashboard shows, so the rank
//     here is the API's own: a crew's place in the rally.
//
// The columns are the ones a result sheet needs and no more: the place, the EQ,
// the crew (navigator and driver in their own columns, so the names line up
// down the page instead of running into one string) and the four numbers —
// ORC's, Tijd, Diversen and the total that decides it. The algemeen klassement
// and the wedstrijdklasse add the class letter, because those are the sheets
// where a reader cannot tell which class a crew rode in from the heading.
//
// A rally of **more than one stage** puts those same four numbers per stage in
// front of the rally total, in running order and headed with the stage's name,
// so a crew can read where in the rally they lost their points and not only how
// many. One stage means the per-stage numbers *are* the rally total, so the
// sheet keeps the plain four columns rather than printing everything twice. The
// numbers per stage come from the standings route with the totals; a stage a
// crew handed no card in for is scored as a blank card — the standings charge
// it, so the sheet prints it — marked with a * and explained in a footnote
// under the table.
//
// Nothing here is scored: it is `GET /api/rallies/[id]/standings` read onto
// paper, so a printed sheet and the screen cannot disagree.
//
// A crew who did not finish is printed as DNF and one who never started as DNS,
// both behind the crews who finished and with their points as they stand: a
// place is for the crews that came in.
//
//   * **Per route** — on a rally ridden in legs, one A4 per route with its own
//     1, 2, 3, ranked on what that leg alone cost a crew. A route is ridden by
//     everybody, so it has a ranking of its own the way a class does; the rally
//     is read on the algemeen klassement and the leg on these. The three groups
//     are read per route as well: no card on the leg at all is a DNS for it, and
//     a hole where its last stage should be is a DNF for it — but only the last
//     route can carry the rally's own disqualification, because inside the rally
//     a blown finish is a penalty and the crew rode on.
//
// A rally ridden in legs also changes what the *rally* sheets show. Four numbers
// per stage on top of four per route and four for the rally do not fit on A4, so
// there **a stage gets one column — its subtotal — and a route gets the four**.
// That is the decomposition the results are ranked on, and a crew's own
// per-stage split is on their card page. Where even that does not fit the
// per-stage columns come off and the sheet prints the four numbers per route;
// the checkbox beside the select forces it either way.
//
// A crew whose class was never recorded is not dropped — they are on the
// combined sheet like everybody else, and get a sheet of their own at the back
// of the per-class print, because a missing class is a gap in the entry list,
// not a reason to leave a scored crew off the results.
//
// This is the one full-page view that does not use `PAGE_CONTAINER`, for the
// same reason a form does not: its width is not the window but the paper. The
// paper is A4 **landscape** — a result sheet is a wide table and it is the crew
// names that run out of room on a portrait page — and the sheets are laid out
// at roughly that width on screen, so what an official sees is what comes out
// of the printer. The app's navigation is not on it: `ClientLayout` hides the
// nav for print, so the sheet starts at its own heading.

interface Rally {
  _id: string;
  name: string;
  code?: string;
}

// One stage of the rally, in running order: the heading of a per-stage group of
// columns, and the route it is ridden in.
interface StandingsStage {
  _id: string;
  name: string;
  routeId?: string | null;
}

// One route of the rally, in the order it is ridden. Empty on a rally with no
// routes, which is how this page tells the two kinds of rally apart.
interface StandingsRouteRef {
  _id: string;
  name: string;
}

// What a crew scored on one stage — the three parts of that one sheet and its
// own total, or what a blank card costs when they have no sheet for it
// (`missingSheet`).
interface StageScore {
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  disqualified: boolean;
  missingSheet?: boolean;
}

interface StandingsEntry {
  eq: number;
  // Finished, did not finish, did not start (app/lib/standings.ts). The two
  // that are not `finished` print their status where a place would be.
  status: StandingsStatus;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  // The same three parts per stage, keyed by stage id. A stage the crew has no
  // sheet for is simply absent.
  stagePenalties?: Record<string, StageScore>;
  sheetsSubmitted: number;
  missingSheets?: number;
  disqualified: boolean;
  rank: number;
}

// A crew on a sheet: a standings entry plus the place it takes *on that sheet*
// — the rally rank on the combined sheet, the place within the class on a class
// sheet, the place within A and H together on the wedstrijdklasse.
type SheetEntry = StandingsEntry & { placing: number };

interface Sheet {
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

// What the print covers. `combined` is the whole field on one sheet, `classes`
// is a sheet per class (the wedstrijdklasse included), `wedstrijd` is that
// combined ranking on its own, and a bare class letter (or `''`, the crews
// without one) is that single class.
//
// A rally ridden in legs adds three: `routes` is a sheet per route, each with
// its own 1, 2, 3; `combined-routes` is the rally sheet with those behind it;
// and `route:<id>` is one route on its own. A 24-character hex id cannot collide
// with a class letter, with `''`, or with any of the words, so a mode is still
// one string.
type PrintMode =
  | 'combined'
  | 'classes'
  | 'wedstrijd'
  | 'routes'
  | 'combined-routes'
  | `route:${string}`
  | ClassificationValue;

const ROUTE_MODE_PREFIX = 'route:';

// The key of the wedstrijdklasse sheet. It cannot collide with a class letter
// or with `'none'`, so a sheet is still addressed by its key alone.
const WEDSTRIJD_KEY = 'wedstrijd';

// The class sheets, in order: the five classes as they are written on the entry
// list, then the crews without one.
const SECTION_CLASSES: ClassificationValue[] = [...CLASSIFICATIONS, ''];

const classLabel = (value: ClassificationValue) =>
  value ? `Klasse ${value}` : 'Zonder klasse';

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

// Print rules that Tailwind has no utility for: the paper size itself, the page
// break between two sheets and the header row that repeats when a sheet runs
// over one page. Kept on this page rather than in globals.css — the QR sheet
// prints its cards on the browser's own default page and should stay that way.
const PRINT_STYLES = `
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

export default function StandingsPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [rallyId, setRallyId] = useState('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [standings, setStandings] = useState<StandingsEntry[]>([]);
  const [stages, setStages] = useState<StandingsStage[]>([]);
  const [routes, setRoutes] = useState<StandingsRouteRef[]>([]);
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

    const view = query.get('view');
    if (view === 'combined' || view === 'wedstrijd') {
      setMode(view);
      return;
    }

    // One route, or a sheet per route. A well-formed id that is not a route of
    // this rally falls into the same empty state `?class=Z` already gets.
    const route = query.get('route');
    if (route === 'all') {
      setMode('routes');
      return;
    }
    if (route && /^[a-f0-9]{24}$/i.test(route)) {
      setMode(`${ROUTE_MODE_PREFIX}${route}`);
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
      setStages(data.stages || []);
      setRoutes(data.routes || []);
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

  // The whole field on one sheet, in the order the API ranked it: the crews who
  // finished first, then the DNF's, then the DNS's, each group on total and then
  // on EQ. The place is that rank — this sheet is the rally's own result, so it
  // does not re-number anything.
  const combinedSheet = useMemo<Sheet | null>(
    () =>
      standings.length === 0
        ? null
        : {
            key: 'combined',
            title: 'Algemeen klassement',
            showClass: true,
            kind: 'rally' as const,
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
        kind: 'rally' as const,
        entries: standings
          .filter((entry) => (entry.classification || '') === classification)
          .map((entry, index) => ({ ...entry, placing: index + 1 })),
      })).filter((sheet) => sheet.entries.length > 0),
    [standings]
  );

  // The wedstrijdklasse: A and H read as one ranking. Filtering keeps the API's
  // order, so the place is the position in what is left — the same way a class
  // sheet is numbered. It names the class of every crew, because this sheet
  // mixes them. No crews in either class means no sheet at all.
  const wedstrijdSheet = useMemo<Sheet | null>(() => {
    const entries = standings
      .filter((entry) => inWedstrijdklasse(entry.classification || ''))
      .map((entry, index) => ({ ...entry, placing: index + 1 }));

    return entries.length === 0
      ? null
      : {
          key: WEDSTRIJD_KEY,
          title: `${WEDSTRIJDKLASSE_LABEL} (${WEDSTRIJDKLASSE_CLASSES.join(' + ')})`,
          showClass: true,
          kind: 'rally' as const,
          entries,
        };
  }, [standings]);

  // The rally's legs with their stages, in the order they are ridden. Empty on a
  // rally with no routes — the gate for everything per-route below.
  const routeGroups = useMemo(() => groupStagesByRoute(stages, routes), [stages, routes]);

  // A crew's totals per route, added up from the per-stage numbers the standings
  // already carry (app/lib/routes.ts). Derived, not fetched: the route sheets and
  // the route subtotals on the rally sheet are then the same numbers by
  // construction rather than by agreement.
  const routeTotalsByEq = useMemo(() => {
    const totals = new Map<number, Record<string, RouteScore>>();
    if (routeGroups.length === 0) return totals;
    standings.forEach((entry) => {
      totals.set(entry.eq, routeTotals(entry.stagePenalties, routeGroups, entry));
    });
    return totals;
  }, [standings, routeGroups]);

  // One sheet per route: the same field, ranked on what that leg alone cost
  // them. A route is ridden by everybody, so it has its own 1, 2, 3 — the rally
  // is read on the algemeen klassement and the leg on these.
  //
  // The route's numbers are written onto the copied entry *as its totals*, the
  // way a class sheet writes `placing`: the table below then prints a route
  // sheet with no new code, and the DNF/DNS label lands in the place column on
  // its own.
  const routeSheets = useMemo<Sheet[]>(
    () =>
      routeGroups
        .filter((group) => group.route)
        .map((group, index) => {
          const route = group.route as { _id: string; name: string };
          const entries = standings
            .map((entry) => ({ entry, score: routeTotalsByEq.get(entry.eq)?.[route._id] }))
            .filter((row): row is { entry: StandingsEntry; score: RouteScore } =>
              Boolean(row.score)
            )
            // The route's own order, and it is the standings' comparator read
            // over the route's numbers: status, then points, then EQ. It is the
            // first sheet on this page whose order is not the API's — a rally
            // rank says nothing about one leg.
            .sort(
              (a, b) =>
                STATUS_ORDER[a.score.status] - STATUS_ORDER[b.score.status] ||
                a.score.totalPenalty - b.score.totalPenalty ||
                a.entry.eq - b.entry.eq
            )
            .map(({ entry, score }, place) => ({
              ...entry,
              orcPenalty: score.orcPenalty,
              timePenalty: score.timePenalty,
              merkPenalty: score.merkPenalty,
              totalPenalty: score.totalPenalty,
              missingSheets: score.missingSheets,
              status: score.status,
              placing: place + 1,
            }));

          return {
            key: `route-${route._id}`,
            title: `Routeklassement ${index + 1}: ${route.name}`,
            subtitle: `${group.stages.length} proeven — alleen de strafpunten van deze route`,
            showClass: true,
            kind: 'route' as const,
            entries,
          };
        })
        .filter((sheet) => sheet.entries.length > 0),
    [routeGroups, standings, routeTotalsByEq]
  );

  const printedSheets = useMemo<Sheet[]>(() => {
    if (mode === 'combined') return combinedSheet ? [combinedSheet] : [];
    if (mode === 'wedstrijd') return wedstrijdSheet ? [wedstrijdSheet] : [];
    if (mode === 'routes') return routeSheets;
    if (mode === 'combined-routes')
      return combinedSheet ? [combinedSheet, ...routeSheets] : routeSheets;
    if (mode.startsWith(ROUTE_MODE_PREFIX)) {
      const routeId = mode.slice(ROUTE_MODE_PREFIX.length);
      return routeSheets.filter((sheet) => sheet.key === `route-${routeId}`);
    }
    // Per class prints the wedstrijdklasse first: it is the ranking the two
    // classes ride for, and their own sheets follow it.
    if (mode === 'classes') return wedstrijdSheet ? [wedstrijdSheet, ...classSheets] : classSheets;
    return classSheets.filter((sheet) => sheet.key === (mode || 'none'));
  }, [mode, combinedSheet, wedstrijdSheet, classSheets, routeSheets]);

  // A rally ridden in legs groups its stage columns under them and adds the four
  // numbers per route. A stage in no route would be dropped from every group, so
  // a sheet that cannot place one falls back to the per-stage sheet and says so
  // on screen.
  const everyStageRouted =
    stages.length > 0 &&
    stages.every((stage) => routes.some((route) => route._id === stage.routeId));
  const showRoutes = routeGroups.length > 0 && everyStageRouted;

  // A rally of one stage scores the same numbers twice — the stage total *is*
  // the rally total — so the per-stage columns only appear once there is more
  // than one stage to tell apart. Unchanged, and it is what a rally with no
  // routes still uses.
  const showStages = !showRoutes && stages.length > 1;
  const sizing = useMemo(() => stageSizing(stages.length), [stages.length]);

  // How many columns one leg contributes: four per stage of it. The
  // `<colgroup>`, the three header rows and the body all have to agree on this
  // — a header row that does not add up is what shears a printed table sideways
  // — so the route heading's span reads it from here rather than restating the
  // arithmetic.
  const routeColumns = (group: { stages: unknown[] }) => 4 * group.stages.length;

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
      <div className="print:hidden mx-auto w-full max-w-[1120px] px-4 sm:px-6">
        <div className="mb-4">
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-base">
            &larr; Back to {rally.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">
            Print Standings — {rally.name}
          </h1>
          <p className="text-gray-700 text-base">
            The results on A4: every class together in one ranking, a sheet per classification
            with its own 1, 2, 3, the wedstrijdklasse — {WEDSTRIJDKLASSE_CLASSES.join(' and ')}{' '}
            ranked as one competition
            {routeSheets.length > 0 ? ', or a ranking per route' : ''}. The numbers are the
            standings as they are on screen — printing scores nothing of its own.
          </p>
          {showStages && (
            <p className="text-gray-700 text-base mt-2">
              {stages.length} stages, so every sheet shows the ORC&apos;s, Tijd, Diversen and the
              subtotal per stage in running order, with the rally total behind them.
            </p>
          )}
          {showRoutes && (
            <p className="text-gray-700 text-base mt-2">
              {stages.length} stages over {routeGroups.length} routes, so the rally sheets show the
              ORC&apos;s, Tijd, Diversen and subtotal per stage, grouped under the route it is
              ridden in, with the rally total behind them. What a whole route cost is what the
              per-route ranking sheets rank on — each route can be printed as a ranking of its own.
            </p>
          )}
          {routeGroups.length > 0 && !everyStageRouted && (
            <p className="text-amber-700 text-base font-medium mt-2">
              {stages.filter((stage) => !routes.some((route) => route._id === stage.routeId)).length}{' '}
              stage(s) of this rally are in no route, so these sheets print per stage instead of
              per route. Give them a route on the stage&apos;s Edit page.
            </p>
          )}
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
              <option value="classes">
                Per class — one sheet each
                {wedstrijdSheet ? ', wedstrijdklasse first' : ''}
              </option>
              {wedstrijdSheet && (
                <option value={WEDSTRIJD_KEY}>
                  {wedstrijdSheet.title} ({wedstrijdSheet.entries.length})
                </option>
              )}
              {classSheets.map((sheet) => (
                <option key={sheet.key} value={sheet.key === 'none' ? '' : sheet.key}>
                  {sheet.title} ({sheet.entries.length})
                </option>
              ))}
              {/* Only on a rally ridden in legs. With no routes the select is
                  byte-identical to what it has always been. */}
              {routeSheets.length > 0 && (
                <>
                  <option value="combined-routes">
                    Algemeen klassement + a sheet per route ({1 + routeSheets.length})
                  </option>
                  <option value="routes">
                    Per route — one sheet each ({routeSheets.length})
                  </option>
                  {routeSheets.map((sheet) => (
                    <option
                      key={sheet.key}
                      value={`${ROUTE_MODE_PREFIX}${sheet.key.slice('route-'.length)}`}
                    >
                      {sheet.title} ({sheet.entries.length})
                    </option>
                  ))}
                </>
              )}
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
      <div className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 print:max-w-none print:px-0">
        {printedSheets.map((sheet) => {
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
        })}
      </div>
    </div>
  );
}
