import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Route, Stage, AnswerSheet, CardAccess } from '../../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../../lib/api-guard';
import {
  MERK_ROWS_PER_CARD,
  ORC_ROWS_PER_CARD,
  parseName,
  parseObjectId,
  processScoreKey,
} from '../../../lib/validation';
import { rescoreRally } from '../../../lib/rescore';
import mongoose from 'mongoose';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 });
    }

    const stage = await Stage.findById(id);

    if (!stage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    return NextResponse.json(stage);
  } catch (error) {
    console.error('Failed to fetch stage:', error);
    return NextResponse.json({ error: 'Failed to fetch stage' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  const name = parseName(body.name);
  if (!name) {
    return NextResponse.json(
      { error: 'Stage name is required (1-200 characters)' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 });
    }

    const stage = await Stage.findById(id);
    if (!stage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    // A crew that runs out of ORC rows mid-stage switches to a second card,
    // carrying its own merk section too; the time module never doubles (see
    // "Second answer card" in CLAUDE.md). Resolved from the body, like the
    // rest of the key: a PUT always resends the whole key, so there is no
    // "leave it alone" case to preserve here.
    const usesSecondCard = body.usesSecondCard === true;
    const orcCap = usesSecondCard ? ORC_ROWS_PER_CARD * 2 : ORC_ROWS_PER_CARD;
    const merkCap = usesSecondCard ? MERK_ROWS_PER_CARD * 2 : MERK_ROWS_PER_CARD;

    const { scoreKey, timeScoreKey, merkScoreKey, timeConfig } = processScoreKey(
      body,
      orcCap,
      merkCap
    );
    const set: Record<string, unknown> = {
      name,
      scoreKey,
      timeScoreKey,
      merkScoreKey,
      timeConfig,
      usesSecondCard,
    };
    let unset: Record<string, string> | null = null;

    // Moving a stage to another leg is a real edit — an official who added a
    // stage to route 1 and only then built route 2 — and the alternative is
    // retyping a 30-row key. It is opt-in the way a rally's code is: a body
    // without `routeId` leaves the stored one alone, which is what stops the
    // stage form (which sends no route on a rally that has none) from silently
    // unassigning a stage.
    if (body.routeId !== undefined) {
      if (!body.routeId) {
        // A rally with routes has no unassigned stages, so clearing one is only
        // legal while the rally has none — where it is a no-op anyway.
        if (await Route.countDocuments({ rallyId: stage.rallyId })) {
          return NextResponse.json(
            { error: 'This rally has routes, so the stage belongs to one of them' },
            { status: 400 }
          );
        }
        unset = { routeId: '' };
      } else {
        const requested = parseObjectId(body.routeId);
        if (!requested) {
          return NextResponse.json({ error: 'Invalid route ID' }, { status: 400 });
        }
        // Scoped to the *stored* stage's rally, never to a rally id off the
        // wire: a route of another rally is a leg this stage's crews never ride.
        const route = await Route.findOne({ _id: requested, rallyId: stage.rallyId });
        if (!route) {
          return NextResponse.json({ error: 'Unknown route' }, { status: 400 });
        }
        set.routeId = route._id;
      }
    }

    const updatedStage = await Stage.findByIdAndUpdate(
      id,
      // Mongoose will not take plain keys beside an operator, so once `$unset`
      // is needed the whole update is written in operators.
      unset ? { $set: set, $unset: unset } : set,
      { new: true, runValidators: true }
    );

    if (!updatedStage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    // Both keys changed, so re-score the whole rally in one bulkWrite: the
    // answer key only affects this stage's sheets, but the time key moves the
    // delta every later stage of every participant starts from — and a stage
    // moved to another route moves the leg boundaries of both.
    await rescoreRally(updatedStage.rallyId);

    return NextResponse.json(updatedStage);
  } catch (error) {
    console.error('Failed to update stage:', error);
    return NextResponse.json({ error: 'Failed to update stage' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 });
    }

    const deletedStage = await Stage.findByIdAndDelete(id);

    if (!deletedStage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    // Cascade: remove all answer sheets submitted for this stage, and the QR
    // codes that were printed for it — a code outlives nothing.
    await Promise.all([
      AnswerSheet.deleteMany({ stageId: id }),
      CardAccess.deleteMany({ stageId: id }),
    ]);

    // The rally is one stage shorter: the time chain, and which finish is the
    // disqualifying one, both move.
    await rescoreRally(deletedStage.rallyId);

    return NextResponse.json({ message: 'Stage deleted successfully' });
  } catch (error) {
    console.error('Failed to delete stage:', error);
    return NextResponse.json({ error: 'Failed to delete stage' }, { status: 500 });
  }
}
