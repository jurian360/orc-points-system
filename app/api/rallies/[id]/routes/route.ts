import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../lib/mongodb';
import { Rally, Route, Stage } from '../../../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../../../lib/api-guard';
import { MAX_ROUTES, parseName, parseObjectId } from '../../../../lib/validation';
import { rescoreRally } from '../../../../lib/rescore';

// The routes of a rally: its sequential legs. Every crew rides route 1, then
// route 2, and a route holds several stages.
//
// Most rallies have none, and that is not a missing setup — **a rally with no
// routes is one implicit leg**, ridden and scored exactly as every rally was
// before routes existed (app/lib/routes.ts). A rally therefore has one of two
// shapes and never a third: no routes at all, or routes with every stage in one
// of them. This route is what keeps that true:
//
//   * the **first** route of a rally takes every stage the rally already has, so
//     creating one cannot leave a stage behind;
//   * a stage created while routes exist has to name one (POST /api/stages);
//   * a route that still holds stages **cannot be deleted** — deleting a
//     grouping must not delete a third of a rally's typed cards.
//
// Everything that changes the legs re-scores the rally, because a leg boundary
// is where the time delta is neutralised: it decides which start is free, which
// finish carries no break, and which finish disqualifies. Renaming a route is
// the one write that does not, a name being no part of the chain.
//
// Reads are `requireSession()` — a data-entry official reads the standings and
// the times, and both now name the rally's routes. Writes are
// `requireRallyAdmin()`: moving a leg boundary moves the delta of the whole
// field, which is squarely the rally's structure.

// GET /api/rallies/[id]/routes — the rally's legs in the order they are ridden,
// each with how many stages it holds (the delete button needs that to warn
// before it is refused).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const [routes, stages] = await Promise.all([
      Route.find({ rallyId: id }).sort({ order: 1, _id: 1 }),
      Stage.find({ rallyId: id }).select('routeId'),
    ]);

    const stageCounts = new Map<string, number>();
    for (const stage of stages) {
      const key = stage.routeId ? String(stage.routeId) : '';
      stageCounts.set(key, (stageCounts.get(key) || 0) + 1);
    }

    return NextResponse.json({
      routes: routes.map((route: any) => ({
        _id: String(route._id),
        rallyId: String(route.rallyId),
        name: route.name,
        order: route.order,
        createdAt: route.createdAt,
        stageCount: stageCounts.get(String(route._id)) || 0,
      })),
      // Stages of a rally that has routes but sit in none. The API does not
      // allow it, so this is normally 0; it is reported rather than hidden
      // because a document edited straight in the database can produce one and
      // an official has to be told to give it a route.
      unassignedStages: routes.length > 0 ? stageCounts.get('') || 0 : 0,
    });
  } catch (error) {
    console.error('Failed to fetch routes:', error);
    return NextResponse.json({ error: 'Failed to fetch routes' }, { status: 500 });
  }
}

// POST /api/rallies/[id]/routes — add a leg to the rally.
//
// The first route takes every stage the rally already has: a rally being given
// routes is a rally whose stages were all typed as one leg, and that leg is what
// route 1 is. Later routes are created empty and stages are moved into them by
// editing the stage.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const name = parseName(parsed.body.name);
  if (!name) {
    return NextResponse.json(
      { error: 'Route name is required (1-200 characters)' },
      { status: 400 }
    );
  }

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const existing = await Route.find({ rallyId: id }).select('order');
    if (existing.length >= MAX_ROUTES) {
      return NextResponse.json(
        { error: `A rally can hold at most ${MAX_ROUTES} routes` },
        { status: 400 }
      );
    }

    const highest = existing.reduce(
      (top: number, route: any) => Math.max(top, route.order || 0),
      0
    );
    const route = await Route.create({ rallyId: id, name, order: highest + 1 });

    // The count above was read before this insert, so two requests at once can
    // both have passed it. Counted again now that this route exists: the one
    // that went over the limit takes its own route back out. It holds no stages
    // — a rally that already had routes gives a new one none.
    if ((await Route.countDocuments({ rallyId: id })) > MAX_ROUTES) {
      await Route.deleteOne({ _id: route._id });
      return NextResponse.json(
        { error: `A rally can hold at most ${MAX_ROUTES} routes` },
        { status: 400 }
      );
    }

    // The first route is the leg the rally's stages were already typed as, so
    // they all move into it. Only the stages that are in no route yet: with a
    // filter on the rally alone, two requests creating the "first" route at the
    // same moment each moved every stage, and the last one took them all from
    // the other. On `routeId: null` the first request takes them and the second
    // finds none, which is what running them one after the other would have
    // done. `null` matches a missing field without an operator — none may be
    // used here: `sanitizeFilter` (app/lib/mongodb.ts) wraps any operator that
    // reaches a filter in `$eq`.
    let assignedStages = 0;
    if (existing.length === 0) {
      const assigned = await Stage.updateMany(
        { rallyId: id, routeId: null },
        { $set: { routeId: route._id } }
      );
      assignedStages = assigned.modifiedCount || 0;
    }

    // A new leg changes where the delta is neutralised and which stage ends the
    // rally, so every participant's time chain has to be rebuilt. That is true
    // of the first route too: it makes no boundary of its own, but the same
    // request repairs any stale route a stage was carrying, and the standings
    // should agree with the documents without a special case.
    await rescoreRally(id);

    return NextResponse.json(
      {
        route: {
          _id: String(route._id),
          rallyId: String(route.rallyId),
          name: route.name,
          order: route.order,
          createdAt: route.createdAt,
          stageCount: assignedStages,
        },
        assignedStages,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: 'This rally already has a route with that name' },
        { status: 409 }
      );
    }
    console.error('Failed to create route:', error);
    return NextResponse.json({ error: 'Failed to create route' }, { status: 500 });
  }
}

// PUT /api/rallies/[id]/routes — the order the rally's legs are ridden in.
//
// The whole order at once (`{ routeIds: [...] }`, first to last) rather than one
// route's place: the places are only meaningful against each other, and a body
// that has to list every route exactly once cannot leave two legs claiming the
// same place.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const requested = Array.isArray(parsed.body.routeIds)
    ? parsed.body.routeIds.slice(0, MAX_ROUTES)
    : null;
  if (!requested) {
    return NextResponse.json({ error: 'routeIds must be an array' }, { status: 400 });
  }

  const routeIds = requested.map(parseObjectId);
  if (routeIds.some((routeId) => routeId === null)) {
    return NextResponse.json({ error: 'Invalid route ID' }, { status: 400 });
  }

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const routes = await Route.find({ rallyId: id });

    // Every route of this rally, exactly once. A partial order would leave the
    // rest of the legs where they were and read as a silent reorder of them too.
    const known = new Set(routes.map((route: any) => String(route._id)));
    const listed = new Set(routeIds as string[]);
    if (
      routeIds.length !== routes.length ||
      listed.size !== routeIds.length ||
      (routeIds as string[]).some((routeId) => !known.has(routeId))
    ) {
      return NextResponse.json(
        { error: 'The order has to list every route of this rally exactly once' },
        { status: 400 }
      );
    }

    if (routes.length > 0) {
      await Route.bulkWrite(
        (routeIds as string[]).map((routeId, index) => ({
          updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(routeId) },
            update: { $set: { order: index + 1 } },
          },
        }))
      );

      // Reordering the legs reorders the whole running order: the delta resets
      // move, the breaks behind the finishes move, and a different stage ends
      // the rally.
      await rescoreRally(id);
    }

    const ordered = await Route.find({ rallyId: id }).sort({ order: 1, _id: 1 });

    return NextResponse.json({
      routes: ordered.map((route: any) => ({
        _id: String(route._id),
        rallyId: String(route.rallyId),
        name: route.name,
        order: route.order,
        createdAt: route.createdAt,
      })),
    });
  } catch (error) {
    console.error('Failed to reorder routes:', error);
    return NextResponse.json({ error: 'Failed to reorder routes' }, { status: 500 });
  }
}
