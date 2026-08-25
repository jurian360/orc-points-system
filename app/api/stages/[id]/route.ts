import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Stage, AnswerSheet, CardAccess } from '../../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../../lib/api-guard';
import { parseName, processScoreKey } from '../../../lib/validation';
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

    const { scoreKey, timeScoreKey, merkScoreKey, timeConfig } = processScoreKey(body);

    const updatedStage = await Stage.findByIdAndUpdate(
      id,
      { name, scoreKey, timeScoreKey, merkScoreKey, timeConfig },
      { new: true, runValidators: true }
    );

    if (!updatedStage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    // Both keys changed, so re-score the whole rally in one bulkWrite: the
    // answer key only affects this stage's sheets, but the time key moves the
    // delta every later stage of every participant starts from.
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
