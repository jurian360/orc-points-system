import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { AnswerSheet, Stage } from '../../../models';
import { calculateTotalPenalty } from '../../../lib/scoring';
import { readBody, requireSession } from '../../../lib/api-guard';
import {
  parseAnswerRows,
  parseEq,
  parseMerkScores,
  parseTimePenalties,
} from '../../../lib/validation';
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
      return NextResponse.json({ error: 'Invalid answer sheet ID' }, { status: 400 });
    }

    const sheet = await AnswerSheet.findById(id);

    if (!sheet) {
      return NextResponse.json({ error: 'Answer sheet not found' }, { status: 404 });
    }

    return NextResponse.json(sheet);
  } catch (error) {
    console.error('Failed to fetch answer sheet:', error);
    return NextResponse.json({ error: 'Failed to fetch answer sheet' }, { status: 500 });
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

  // Only validate eq when the client is actually changing it.
  let eq: number | null = null;
  if (body.eq !== undefined) {
    eq = parseEq(body.eq);
    if (eq === null) {
      return NextResponse.json(
        { error: 'eq must be an integer between 1 and 100' },
        { status: 400 }
      );
    }
  }

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

    const stage = await Stage.findById(sheet.stageId);
    const answers = body.answers !== undefined ? parseAnswerRows(body.answers) : sheet.answers;

    if (eq !== null) sheet.eq = eq;
    sheet.answers = answers;
    if (body.timePenalties !== undefined) {
      sheet.timePenalties = parseTimePenalties(body.timePenalties);
    }
    if (body.merkScores !== undefined) {
      sheet.merkScores = parseMerkScores(body.merkScores);
    }
    sheet.totalPenalty = calculateTotalPenalty(stage ? stage.scoreKey : [], answers);

    const updatedSheet = await sheet.save();

    return NextResponse.json(updatedSheet);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'This participant already has an answer sheet for this stage' },
        { status: 409 }
      );
    }

    console.error('Failed to update answer sheet:', error);
    return NextResponse.json({ error: 'Failed to update answer sheet' }, { status: 500 });
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
      return NextResponse.json({ error: 'Invalid answer sheet ID' }, { status: 400 });
    }

    const deletedSheet = await AnswerSheet.findByIdAndDelete(id);

    if (!deletedSheet) {
      return NextResponse.json({ error: 'Answer sheet not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Answer sheet deleted successfully' });
  } catch (error) {
    console.error('Failed to delete answer sheet:', error);
    return NextResponse.json({ error: 'Failed to delete answer sheet' }, { status: 500 });
  }
}
