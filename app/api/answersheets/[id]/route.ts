import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { AnswerSheet, Stage } from '../../../models';
import { calculateTotalPenalty } from '../../../lib/scoring';
import mongoose from 'mongoose';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid answer sheet ID' }, { status: 400 });
    }

    const sheet = await AnswerSheet.findById(id);

    if (!sheet) {
      return NextResponse.json({ error: 'Answer sheet not found' }, { status: 404 });
    }

    return NextResponse.json(sheet);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch answer sheet' }, { status: 500 });
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
      return NextResponse.json({ error: 'Invalid answer sheet ID' }, { status: 400 });
    }

    const sheet = await AnswerSheet.findById(id);
    if (!sheet) {
      return NextResponse.json({ error: 'Answer sheet not found' }, { status: 404 });
    }

    const stage = await Stage.findById(sheet.stageId);
    const answers = body.answers ?? sheet.answers;

    sheet.eq = body.eq ?? sheet.eq;
    sheet.answers = answers;
    if (body.timePenalties) sheet.timePenalties = body.timePenalties;
    if (body.merkScores) sheet.merkScores = body.merkScores;
    sheet.totalPenalty = calculateTotalPenalty(stage ? stage.scoreKey : [], answers);

    const updatedSheet = await sheet.save();

    return NextResponse.json(updatedSheet);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update answer sheet' }, { status: 500 });
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
      return NextResponse.json({ error: 'Invalid answer sheet ID' }, { status: 400 });
    }

    const deletedSheet = await AnswerSheet.findByIdAndDelete(id);

    if (!deletedSheet) {
      return NextResponse.json({ error: 'Answer sheet not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Answer sheet deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete answer sheet' }, { status: 500 });
  }
}
