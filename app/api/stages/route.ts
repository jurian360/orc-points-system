import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Rally, Route, Stage } from '../../models';
import {
  readBody,
  requireRallyAdmin,
  requireSession,
  withoutScoreKeys,
} from '../../lib/api-guard';
import { can } from '../../lib/roles';
import { parseName, parseObjectId, processScoreKey } from '../../lib/validation';
import { rescoreRally } from '../../lib/rescore';
import { loadRunningOrder } from '../../lib/rallyOrder';
import mongoose from 'mongoose';

// Every official may list a rally's stages — it is how each page knows what
// the stages are called and in what order they run. A stage also *carries* its
// answer key, and an official without `view:keys` (a classification admin) has
// it withheld below rather than being refused the list.
export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { searchParams } = new URL(request.url);
  const rallyId = searchParams.get('rallyId');

  if (!rallyId || !mongoose.Types.ObjectId.isValid(rallyId)) {
    return NextResponse.json({ error: 'Valid rallyId is required' }, { status: 400 });
  }

  try {
    await dbConnect();

    // Running order: the rally's routes in their order, and inside a route its
    // stages in creation order — the order the time delta is chained in, and the
    // one every client reads positionally ("the last one is the stage whose
    // finish disqualifies"). A rally with no routes comes back in exactly the
    // creation order it always did (app/lib/rallyOrder.ts).
    //
    // Still a bare array of stage documents: eight client files read it as one,
    // several of them as `stages[stages.length - 1]`. Each stage names its route
    // in `routeId`, which is enough to group them; the route *names* come from
    // GET /api/rallies/[id]/routes.
    const { stages } = await loadRunningOrder(rallyId);

    return NextResponse.json(
      can(session.user.role, 'view:keys') ? stages : stages.map(withoutScoreKeys)
    );
  } catch (error) {
    console.error('Failed to fetch stages:', error);
    return NextResponse.json({ error: 'Failed to fetch stages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  const rallyId = body.rallyId;
  if (typeof rallyId !== 'string' || !mongoose.Types.ObjectId.isValid(rallyId)) {
    return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
  }

  const name = parseName(body.name);
  if (!name) {
    return NextResponse.json(
      { error: 'Stage name is required (1-200 characters)' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const rally = await Rally.findById(rallyId);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    // A rally either has no routes — every stage is in the one implicit leg — or
    // it has them, and then every stage belongs to one. So the route is required
    // exactly when the rally has routes: a stage that silently landed in the
    // wrong leg would move the delta reset for the whole field, and nothing on
    // screen would say so.
    const routes = await Route.find({ rallyId }).select('_id');

    let routeId: unknown;
    if (routes.length > 0) {
      const requested = parseObjectId(body.routeId);
      // It has to be one of *this* rally's routes, checked against the list
      // already in hand. A route id from another rally would put a stage in a
      // leg its crews never ride.
      const route = requested
        ? routes.find((entry: any) => String(entry._id) === requested)
        : undefined;
      if (!route) {
        return NextResponse.json(
          { error: 'This rally has routes, so the stage needs one of them' },
          { status: 400 }
        );
      }
      routeId = route._id;
    } else if (body.routeId) {
      // A rally with no routes has no leg to put a stage in.
      return NextResponse.json({ error: 'This rally has no routes' }, { status: 400 });
    }

    const { scoreKey, timeScoreKey, merkScoreKey, timeConfig } = processScoreKey(body);

    const stage = new Stage({
      rallyId,
      routeId,
      name,
      scoreKey,
      timeScoreKey,
      merkScoreKey,
      timeConfig,
    });
    const savedStage = await stage.save();

    // The new stage is now the last one of its route, so the finish of the stage
    // that used to be last there stops carrying no break — and on the last route
    // it stops being a disqualification and becomes a penalty. Every
    // participant's time chain has to be rebuilt.
    await rescoreRally(rallyId);

    return NextResponse.json(savedStage, { status: 201 });
  } catch (error) {
    console.error('Failed to create stage:', error);
    return NextResponse.json({ error: 'Failed to create stage' }, { status: 500 });
  }
}
