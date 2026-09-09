import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../../lib/mongodb';
import { Route, Stage } from '../../../../../models';
import { readBody, requireRallyAdmin } from '../../../../../lib/api-guard';
import { parseName } from '../../../../../lib/validation';
import { rescoreRally } from '../../../../../lib/rescore';

// One leg of a rally: rename it, or remove it.
//
// Both verbs load the route and check it belongs to the rally in the path. A
// route of another rally answers **404** rather than 403: at this address it does
// not exist, and saying which of the two it is would be saying something about
// another rally.

// Load a route that belongs to this rally.
async function loadRoute(rallyId: string, routeId: string) {
  if (
    !mongoose.Types.ObjectId.isValid(rallyId) ||
    !mongoose.Types.ObjectId.isValid(routeId)
  ) {
    return null;
  }

  await dbConnect();

  const route = await Route.findById(routeId);
  if (!route || String(route.rallyId) !== rallyId) return null;
  return route;
}

// PUT /api/rallies/[id]/routes/[routeId] — rename a leg.
//
// The one write on a route that does **not** re-score the rally: a name is no
// part of the time chain. Only the printed per-route heading changes.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; routeId: string }> }
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
    const { id, routeId } = await params;

    const route = await loadRoute(id, routeId);
    if (!route) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }

    route.name = name;
    await route.save();

    return NextResponse.json({
      route: {
        _id: String(route._id),
        rallyId: String(route.rallyId),
        name: route.name,
        order: route.order,
        createdAt: route.createdAt,
      },
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: 'This rally already has a route with that name' },
        { status: 409 }
      );
    }
    console.error('Failed to rename route:', error);
    return NextResponse.json({ error: 'Failed to rename route' }, { status: 500 });
  }
}

// DELETE /api/rallies/[id]/routes/[routeId] — remove a leg.
//
// **Refused while the route still holds stages**, unlike deleting a stage, which
// takes its answer sheets with it. A stage is the unit an official works in and
// its delete dialog says what goes; a route is a *grouping*, and destroying the
// grouping must never destroy a third of a rally's typed cards. The stages are
// moved to another route first, one edit each.
//
// Removing the rally's last route puts it back to having none — one implicit leg
// holding every stage, which is what it was before routes were added to it.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; routeId: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  try {
    const { id, routeId } = await params;

    const route = await loadRoute(id, routeId);
    if (!route) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }

    const stages = await Stage.find({ rallyId: id, routeId: route._id }).select('name');
    if (stages.length > 0) {
      return NextResponse.json(
        {
          error: 'This route still holds stages — move them to another route first',
          // Named so the panel can say which ones without a second request. Not
          // in `error`: the message an official reads stays one sentence.
          stages: stages.map((stage: any) => ({
            _id: String(stage._id),
            name: stage.name,
          })),
        },
        { status: 409 }
      );
    }

    await route.deleteOne();

    // The route was empty, so this changes nothing — but a stage that acquired a
    // stale route some other way is returned to the implicit leg rather than
    // left pointing at a route that no longer exists.
    await Stage.updateMany({ rallyId: id, routeId: route._id }, { $unset: { routeId: '' } });

    // One leg fewer: the delta resets move, and a different stage ends the rally.
    await rescoreRally(id);

    return NextResponse.json({ message: 'Route deleted' });
  } catch (error) {
    console.error('Failed to delete route:', error);
    return NextResponse.json({ error: 'Failed to delete route' }, { status: 500 });
  }
}
