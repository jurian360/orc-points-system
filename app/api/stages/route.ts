import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Stage, Rally } from '../../models';
import mongoose from 'mongoose';

// Normalize the incoming answer-key sections into the stored shape.
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

export async function GET(request: NextRequest) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const rallyId = searchParams.get('rallyId');

    if (!rallyId || !mongoose.Types.ObjectId.isValid(rallyId)) {
      return NextResponse.json({ error: 'Valid rallyId is required' }, { status: 400 });
    }

    const stages = await Stage.find({ rallyId }).sort({ createdAt: 1 });
    return NextResponse.json(stages);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch stages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    await dbConnect();

    if (!mongoose.Types.ObjectId.isValid(body.rallyId)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const rally = await Rally.findById(body.rallyId);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Stage name is required' }, { status: 400 });
    }

    const { scoreKey, timeScoreKey, merkScoreKey } = processScoreKey(body);

    const stage = new Stage({
      rallyId: body.rallyId,
      name: body.name.trim(),
      scoreKey,
      timeScoreKey,
      merkScoreKey,
    });

    const savedStage = await stage.save();

    return NextResponse.json(savedStage, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create stage' }, { status: 500 });
  }
}
