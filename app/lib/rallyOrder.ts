import 'server-only';

// Reading a rally's running order out of the database.
//
// The rules themselves live in `app/lib/routes.ts`, which is pure and shared
// with the browser; this is only the query. The split is the one `rallyCodes.ts`
// (pure) and `appCards.ts` (server-only) already make: the client needs the same
// grouping for the entry form's live preview and the printed sheet, and it cannot
// import the models.
//
// The order used to be `sort({ createdAt: 1, _id: 1 })`, written out in seven
// different files. With routes it has a second component — the routes in their
// order, and inside a route the stages in their creation order — so that
// duplication stops being cosmetic and everything reads it from here.

import { Route, Stage } from '../models';
import {
  groupStagesByRoute,
  legPositionsById,
  orderStagesByRoute,
  type LegPosition,
  type RallyRoute,
  type RouteGroup,
} from './routes';

// The whole running order of one rally.
export interface RallyRunningOrder {
  // Every stage of the rally, flat, in the order it is ridden. On a rally with
  // no routes this is exactly the list the seven old sorts returned.
  stages: any[];
  // The rally's routes, in their order. Empty on a rally with no routes, which
  // is how a caller tells the two kinds of rally apart.
  routes: any[];
  // The legs with their stages — empty when the rally has no routes, so a caller
  // renders the flat list it always rendered rather than a group of one.
  legs: RouteGroup<any>[];
  // Where each stage sits in the legs, by stage id: which start is free, which
  // finish carries no break, and the one finish that disqualifies.
  positionByStage: Map<string, LegPosition>;
  hasRoutes: boolean;
}

// The stages of a rally in running order, with their legs.
//
// `stageFields` is a Mongoose projection for the stages, as the callers that
// only want a few fields already pass. `routeId` and `createdAt` are appended to
// whatever is given: a projection that left them out would silently collapse the
// whole rally into one leg in creation order, which is the one failure this
// module exists to prevent.
export async function loadRunningOrder(
  rallyId: unknown,
  stageFields?: string
): Promise<RallyRunningOrder> {
  const [routes, stages] = await Promise.all([
    Route.find({ rallyId }).sort({ order: 1, _id: 1 }),
    (stageFields
      ? Stage.find({ rallyId }).select(`${stageFields} routeId createdAt`)
      : Stage.find({ rallyId })
    ).sort({ createdAt: 1, _id: 1 }),
  ]);

  // `routes` are Mongoose documents; the pure helpers only read `_id`, `name`
  // and `order` off them.
  const routeRefs = routes as unknown as RallyRoute[];
  const ordered = orderStagesByRoute(stages, routeRefs);

  return {
    stages: ordered,
    routes,
    legs: groupStagesByRoute(stages, routeRefs),
    positionByStage: legPositionsById(ordered),
    hasRoutes: routes.length > 0,
  };
}
