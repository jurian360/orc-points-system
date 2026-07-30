import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { AnswerSheet, Stage } from '../../models';
import { calculateTotalPenalty } from '../../lib/scoring';
import mongoose from 'mongoose';

// GET /api/answersheets?stageId=... or ?rallyId=... (optionally &eq=...)
// Returns answer sheets filtered by stage or rally.
export async function GET(request: NextRequest) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const stageId = searchParams.get('stageId');
    const rallyId = searchParams.get('rallyId');
    const eq = searchParams.get('eq');

    const query: Record<string, unknown> = {};

    if (stageId) {
      if (!mongoose.Types.ObjectId.isValid(stageId)) {
        return NextResponse.json({ error: 'Invalid stageId' }, { status: 400 });
      }
      query.stageId = stageId;
    } else if (rallyId) {
      if (!mongoose.Types.ObjectId.isValid(rallyId)) {
        return NextResponse.json({ error: 'Invalid rallyId' }, { status: 400 });
      }
      query.rallyId = rallyId;
    } else {
      return NextResponse.json(
        { error: 'A stageId or rallyId is required' },
        { status: 400 }
      );
    }

    if (eq) {
      query.eq = Number(eq);
    }

    const sheets = await AnswerSheet.find(query).sort({ submittedAt: -1 });
    return NextResponse.json(sheets);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch answer sheets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    await dbConnect();

    if (!mongoose.Types.ObjectId.isValid(body.stageId)) {
      return NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 });
    }

    const stage = await Stage.findById(body.stageId);
    if (!stage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    // A participant may only submit one sheet per stage.
    const existing = await AnswerSheet.findOne({
      eq: body.eq,
      stageId: body.stageId,
    });

    if (existing) {
      return NextResponse.json(
        { error: 'This participant already has an answer sheet for this stage' },
        { status: 400 }
      );
    }

    const answers = body.answers || [];
    const totalPenalty = calculateTotalPenalty(stage.scoreKey, answers);

    const answerSheet = new AnswerSheet({
      eq: body.eq,
      rallyId: stage.rallyId,
      stageId: body.stageId,
      answers,
      timePenalties: body.timePenalties || [],
      merkScores: body.merkScores || [],
      totalPenalty,
    });

    const savedSheet = await answerSheet.save();

    return NextResponse.json(savedSheet, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save answer sheet' }, { status: 500 });
  }
}
