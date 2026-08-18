import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Stage, AnswerSheet } from '../../../models';
import { calculateTotalPenalty } from '../../../lib/scoring';
import { readBody, requireSession } from '../../../lib/api-guard';
import { parseName, processScoreKey } from '../../../lib/validation';
import mongoose from 'mongoose';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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

    const { scoreKey, timeScoreKey, merkScoreKey } = processScoreKey(body);

    const updatedStage = await Stage.findByIdAndUpdate(
      id,
      { name, scoreKey, timeScoreKey, merkScoreKey },
      { new: true, runValidators: true }
    );

    if (!updatedStage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    // The answer key changed, so re-score every answer sheet for this stage.
    // One bulkWrite instead of a save() per sheet: the previous loop turned a
    // single stage edit into N database round-trips.
    const sheets = await AnswerSheet.find({ stageId: id }).select('_id answers');

    if (sheets.length > 0) {
      await AnswerSheet.bulkWrite(
        sheets.map((sheet) => ({
          updateOne: {
            filter: { _id: sheet._id },
            update: {
              $set: {
                totalPenalty: calculateTotalPenalty(updatedStage.scoreKey, sheet.answers),
              },
            },
          },
        }))
      );
    }

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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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

    // Cascade: remove all answer sheets submitted for this stage.
    await AnswerSheet.deleteMany({ stageId: id });

    return NextResponse.json({ message: 'Stage deleted successfully' });
  } catch (error) {
    console.error('Failed to delete stage:', error);
    return NextResponse.json({ error: 'Failed to delete stage' }, { status: 500 });
  }
}
