// The legs of a rally, and the order it is ridden in.
//
// Most rallies are one continuous leg: a flat list of stages whose time delta
// runs from the free start of the first stage to the disqualifying finish of the
// last one. Two events a year are ridden in **routes** instead — separate legs,
// each with its own stages, where the crews are re-started on a fresh schedule.
// At a route boundary the delta is neutralised and the start is free again.
//
// A rally with no routes is **one leg holding every stage**. That is not a
// special case bolted on the side: it is what makes every rule below collapse to
// what the app did before routes existed. "The first stage of the rally" becomes
// "the first stage of its leg", and "the last stage of the rally" splits into two
// different questions that used to be one:
//
//   * `endsRoute` — no further stage of the **same** route follows, so the break
//     after this stage is not charged with its finish;
//   * `endsRally` — the last stage of the last route: the one finish in the whole
//     rally that disqualifies.
//
// With no routes those two are the same stage and the same answer, which is why
// they used to be one flag (`isFinalStage`). They are separated here because
// conflating them is the one way this feature can silently mis-score a rally.
//
// Pure and shared, client + server, like `standings.ts` and `participants.ts`:
// the scoring, the standings route, the entry form's live preview and the printed
// sheet all have to answer "which leg is this stage in" the same way, and a
// second implementation is a second answer.

import { resolveStatus, type StandingsStatus } from './standings';

// A route as everything outside the database needs it: its name, and where it
// sits in the rally. `order` is what a rally is ridden in — 1, 2, 3 — because a
// route, unlike a stage, is reordered by hand.
export interface RallyRoute {
  _id: string;
  name: string;
  order?: number;
}

// Anything that knows which route it is in: a Stage document, a stage from
// `GET /api/stages`, or a bare `{ routeId }` built for the scoring.
export interface RoutedStage {
  routeId?: unknown;
}

// A route id as a key. A stage in no route keys `''` — the one implicit leg of a
// rally without routes — so the two kinds of rally are one code path.
export const NO_ROUTE = '';

export function routeKey(routeId: unknown): string {
  return routeId === null || routeId === undefined ? NO_ROUTE : String(routeId);
}

// Where a stage sits in the rally's legs. Index-aligned with the list it was
// derived from.
export interface LegPosition {
  // The route this stage is in, `''` for the implicit leg.
  routeId: string;
  // 0-based place of its leg in the running order.
  legIndex: number;
  // 1-based place of the stage in the rally, and in its own leg. The first is
  // what the QR sheet's card number and the app's `kaartnr` show.
  position: number;
  positionInLeg: number;
  // The first stage of its route: the delta begins here, so its start row is
  // free — shown, costing nothing, and not moving the delta.
  startsRoute: boolean;
  // The last stage of its route: no further stage of the same route follows, so
  // the break after it is not charged with its finish.
  endsRoute: boolean;
  // The last stage of the last route — the rally's own finish, and the only one
  // where a blown or missing finish disqualifies. Implies `endsRoute`.
  endsRally: boolean;
}

// One leg of the rally: a route and the stages ridden in it.
export interface RouteGroup<T> {
  // The route, or `null` for stages in none. A rally with no routes has no
  // groups at all (see `groupStagesByRoute`), so a `null` here means the one
  // thing the API forbids: a stage left out of a rally that does have routes.
  route: RallyRoute | null;
  // 1-based place of this leg in the running order.
  position: number;
  stages: T[];
  // The last leg that holds stages — the one whose final stage ends the rally.
  isLast: boolean;
}

// Routes in the order the rally is ridden. `_id` breaks a tie, so a rally whose
// routes all read `order: 0` still has one stable order rather than whatever the
// database happened to return.
export function compareRoutes(a: RallyRoute, b: RallyRoute): number {
  return (a.order || 0) - (b.order || 0) || String(a._id).localeCompare(String(b._id));
}

// Rank of each route, by id. A stage whose route is absent — or names a route
// this rally does not have — ranks **-1** and therefore sorts ahead of every
// route, as a leading leg of its own.
//
// That direction is deliberate. Such a stage is a hole in the hierarchy the API
// does not allow (a rally either has no routes, or every stage is in one), but a
// document edited straight in the database can still produce one, and this module
// is what has to survive it. Sorting an orphan **last** would make its finish the
// rally's finish: the real last stage would stop disqualifying, and every crew
// who missed the real finish would silently read as having finished. Sorting it
// first costs a spurious delta reset and nothing else.
function routeRanks(routes: RallyRoute[]): Map<string, number> {
  const ranks = new Map<string, number>();
  [...routes].sort(compareRoutes).forEach((route, index) => {
    ranks.set(String(route._id), index);
  });
  return ranks;
}

// The stages of a rally in the order it is ridden: the routes in their order,
// and inside a route the order they came in — which is their creation order, the
// order every one of these lists already arrives in.
//
// Only the route rank is compared here. `createdAt` is deliberately never read:
// it is a `Date` on the server and an ISO string in the browser, and this module
// runs in both. The relative order inside a leg is instead the caller's own,
// preserved by sorting on one key and relying on a stable sort.
//
// A rally with no routes therefore comes back in exactly the order it was given.
export function orderStagesByRoute<T extends RoutedStage>(
  stages: readonly T[],
  routes: readonly RallyRoute[]
): T[] {
  if (routes.length === 0) return [...stages];

  const ranks = routeRanks([...routes]);
  return [...stages].sort(
    (a, b) => (ranks.get(routeKey(a.routeId)) ?? -1) - (ranks.get(routeKey(b.routeId)) ?? -1)
  );
}

// Where every stage of a list sits in the rally's legs.
//
// PRECONDITION: the list is already in running order — `orderStagesByRoute`, or
// `GET /api/stages`, which runs it. The boundaries are read as adjacency on the
// route id, so a list that is not grouped reads as more legs than the rally has.
// That is checked nowhere on purpose: this runs in a browser render path, and an
// exception there would take a page down over a data problem a re-score fixes.
export function legPositions(stages: readonly RoutedStage[]): LegPosition[] {
  let legIndex = -1;
  let positionInLeg = 0;

  return stages.map((stage, index) => {
    const routeId = routeKey(stage.routeId);
    const startsRoute = index === 0 || routeKey(stages[index - 1].routeId) !== routeId;
    const endsRoute =
      index === stages.length - 1 || routeKey(stages[index + 1].routeId) !== routeId;

    if (startsRoute) {
      legIndex += 1;
      positionInLeg = 0;
    }
    positionInLeg += 1;

    return {
      routeId,
      legIndex,
      position: index + 1,
      positionInLeg,
      startsRoute,
      endsRoute,
      endsRally: index === stages.length - 1,
    };
  });
}

// The same, looked up by stage id, for the callers that ask about one stage
// rather than walking the rally.
export function legPositionsById<S extends RoutedStage & { _id: unknown }>(
  stages: readonly S[]
): Map<string, LegPosition> {
  const positions = legPositions(stages);
  return new Map(stages.map((stage, index) => [String(stage._id), positions[index]]));
}

// The rally's legs, with their stages.
//
// **Empty for a rally with no routes**, so a caller renders the flat list it
// always rendered instead of a group of one. That is what keeps the eight rallies
// in ten that have no routes looking exactly as they do today: `groups.length ===
// 0` is the gate, and there is no heading to draw with no name to put in it.
export function groupStagesByRoute<S extends RoutedStage & { _id: unknown }>(
  stages: readonly S[],
  routes: readonly RallyRoute[]
): RouteGroup<S>[] {
  if (routes.length === 0) return [];

  const ordered = orderStagesByRoute(stages, routes);
  const byId = new Map(routes.map((route) => [String(route._id), route]));
  const groups: RouteGroup<S>[] = [];

  legPositions(ordered).forEach((position, index) => {
    if (position.startsRoute) {
      groups.push({
        route: byId.get(position.routeId) || null,
        position: groups.length + 1,
        stages: [],
        isLast: false,
      });
    }
    groups[groups.length - 1].stages.push(ordered[index]);
  });

  // A route with no stages is not a leg of anything, so it is not listed — but
  // the last leg that *does* hold stages is the one whose final stage ends the
  // rally.
  if (groups.length > 0) groups[groups.length - 1].isLast = true;

  return groups;
}

// What a crew scored on one stage, as the standings carry it. Declared here
// rather than imported from app/types, which imports *from* app/lib.
export interface RouteStageScore {
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  missingSheet: boolean;
}

// What a crew scored on one route: the three parts of their rally total over that
// leg alone, and how they ended it.
export interface RouteScore {
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  // Cards this crew handed in on this route, and stages of it they handed none
  // for — each of those scored as the blank card it stands for.
  sheetsSubmitted: number;
  missingSheets: number;
  status: StandingsStatus;
}

// A crew's totals per route, added up from the per-stage numbers the standings
// already carry. Derived and never stored: a second copy of a number is a second
// place for it to disagree, and this is the same reason the printed sheet
// re-ranks the per-class results where it prints them instead of asking the API
// for a second ranking.
//
// The three groups are read per route the same way they are read per rally
// (`app/lib/standings.ts`), which is a *reading* of that one rule and not a
// fourth status:
//
//   * **DNS for a route** — no card for any of its stages. Entered, and did not
//     start this leg.
//   * **DNF for a route** — a card somewhere in the route, but a hole where its
//     last stage should be.
//   * `disqualified` counts **only on the last route**, because inside a rally a
//     blown finish window is a penalty and only the finish of the last stage of
//     the last route puts a crew out. Printing a crew DNF for route 1 because
//     they blew its last finish is a judgement the sport does not make — they
//     rode on.
export function routeTotals<S extends RoutedStage & { _id: unknown }>(
  stagePenalties: Record<string, RouteStageScore> | undefined,
  groups: readonly RouteGroup<S>[],
  entry: { disqualified: boolean }
): Record<string, RouteScore> {
  const totals: Record<string, RouteScore> = {};

  for (const group of groups) {
    if (!group.route) continue;

    const score: RouteScore = {
      totalPenalty: 0,
      orcPenalty: 0,
      timePenalty: 0,
      merkPenalty: 0,
      sheetsSubmitted: 0,
      missingSheets: 0,
      status: 'dns',
    };

    for (const stage of group.stages) {
      const stageScore = stagePenalties?.[String(stage._id)];
      if (!stageScore) {
        // No numbers at all for a stage of this route. The standings fill a
        // blank card in for every stage, so this only happens on a response
        // that predates that — count it as unridden rather than as free.
        score.missingSheets += 1;
        continue;
      }
      score.totalPenalty += stageScore.totalPenalty;
      score.orcPenalty += stageScore.orcPenalty;
      score.timePenalty += stageScore.timePenalty;
      score.merkPenalty += stageScore.merkPenalty;
      if (stageScore.missingSheet) score.missingSheets += 1;
      else score.sheetsSubmitted += 1;
    }

    const lastStage = group.stages[group.stages.length - 1];
    const lastScore = lastStage ? stagePenalties?.[String(lastStage._id)] : undefined;

    score.status = resolveStatus({
      sheetsSubmitted: score.sheetsSubmitted,
      disqualified: group.isLast && entry.disqualified,
      missingLastStageSheet: Boolean(lastStage) && (!lastScore || lastScore.missingSheet),
    });

    totals[String(group.route._id)] = score;
  }

  return totals;
}
