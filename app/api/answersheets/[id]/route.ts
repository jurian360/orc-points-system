import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { AnswerSheet, Stage } from '../../../models';
import { calculateMerkPenalty, calculateTotalPenalty } from '../../../lib/scoring';
import { readBody, requireSession } from '../../../lib/api-guard';
import { rescoreParticipants } from '../../../lib/rescore';
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

    const previousEq = sheet.eq;
    if (eq !== null) sheet.eq = eq;
    sheet.answers = answers;
    if (body.timePenalties !== undefined) {
      // Only the WPT survives the parse; the rescore below recomputes the rest.
      sheet.timePenalties = parseTimePenalties(body.timePenalties);
    }
    if (body.merkScores !== undefined) {
      // Only the letters survive the parse; the rescore below scores the column.
      sheet.merkScores = parseMerkScores(body.merkScores);
    }
    const merkPenalty = calculateMerkPenalty(
      stage ? stage.merkScoreKey : [],
      sheet.merkScores
    ).totalPenalty;
    sheet.merkPenalty = merkPenalty;
    // ORC's + merk; rescoreParticipants adds the time part below.
    sheet.totalPenalty =
      calculateTotalPenalty(stage ? stage.scoreKey : [], answers) + merkPenalty;

    const updatedSheet = await sheet.save();

    // Renumbering a sheet moves it between two participants' time chains, so
    // both have to be rebuilt.
    await rescoreParticipants(sheet.rallyId, [previousEq, sheet.eq]);

    const scoredSheet = await AnswerSheet.findById(updatedSheet._id);

    return NextResponse.json(scoredSheet || updatedSheet);
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

    // The removed stage no longer contributes to this participant's delta, so
    // the stages after it have to be re-scored.
    await rescoreParticipants(deletedSheet.rallyId, [deletedSheet.eq]);

    return NextResponse.json({ message: 'Answer sheet deleted successfully' });
  } catch (error) {
    console.error('Failed to delete answer sheet:', error);
    return NextResponse.json({ error: 'Failed to delete answer sheet' }, { status: 500 });
  }
}
