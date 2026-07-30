import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Stage, AnswerSheet } from '../../../models';
import { calculateTotalPenalty } from '../../../lib/scoring';
import mongoose from 'mongoose';

function processScoreKey(body: any) {
  const scoreKey = (body.scoreKey || []).map((row: any) => ({
    rowNumber: row.rowNumber,
    answers: row.answers || [],
    falseAnswers: row.falseAnswers || [],
    maxPenalty: typeof row.maxPenalty === 'number' ? row.maxPenalty : 0,
  }));

  const timeScoreKey = (body.timeScoreKey || []).map((row: any) => ({
    rowNumber: row.rowNumber,
    ipt: row.ipt || '',
    wpt: row.wpt || '',
    plusMinus: row.plusMinus || '',
    maxPenalty: typeof row.maxPenalty === 'number' ? row.maxPenalty : 0,
  }));

  const merkScoreKey = (body.merkScoreKey || []).map((row: any) => ({
    rowNumber: row.rowNumber,
    merk: row.merk || '',
    maxPenalty: typeof row.maxPenalty === 'number' ? row.maxPenalty : 0,
  }));

  return { scoreKey, timeScoreKey, merkScoreKey };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    return NextResponse.json({ error: 'Failed to fetch stage' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    const { id } = await params;
    const body = await request.json();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 });
    }

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Stage name is required' }, { status: 400 });
    }

    const { scoreKey, timeScoreKey, merkScoreKey } = processScoreKey(body);

    const updatedStage = await Stage.findByIdAndUpdate(
      id,
      {
        name: body.name.trim(),
        scoreKey,
        timeScoreKey,
        merkScoreKey,
      },
      { new: true, runValidators: true }
    );

    if (!updatedStage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    // The answer key changed, so re-score every answer sheet for this stage.
    const sheets = await AnswerSheet.find({ stageId: id });
    await Promise.all(
      sheets.map((sheet) => {
        sheet.totalPenalty = calculateTotalPenalty(updatedStage.scoreKey, sheet.answers);
        return sheet.save();
      })
    );

    return NextResponse.json(updatedStage);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update stage' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    return NextResponse.json({ error: 'Failed to delete stage' }, { status: 500 });
  }
}
