import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { AnswerSheet, Participant, Stage } from '../../../models';
import { calculateMerkPenalty, calculateTotalPenalty } from '../../../lib/scoring';
import { readBody, requireSession } from '../../../lib/api-guard';
import { rescoreParticipants } from '../../../lib/rescore';
import {
  MERK_ROWS_PER_CARD,
  ORC_ROWS_PER_CARD,
  parseAnswerRows,
  parseEq,
  parseMerkScores,
  parseDiversenCount,
  DIVERSEN_COUNT_ERROR,
  parseTimePenalties,
} from '../../../lib/validation';
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
  const session = await requireSession();
  if (!session.ok) return session.response;

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

  // Like the merk letters, only written when the client sent it.
  let diversenCount: number | null = null;
  if (body.diversenCount !== undefined) {
    diversenCount = parseDiversenCount(body.diversenCount);
    if (diversenCount === null) {
      return NextResponse.json({ error: DIVERSEN_COUNT_ERROR }, { status: 400 });
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

    // Renumbering a sheet hands it to another crew, so the new number has to be
    // one the rally knows — the same entry-list guard the POST applies. Leaving
    // the number alone is never blocked: a sheet that predates the entry list
    // still has to be correctable.
    if (eq !== null && eq !== sheet.eq) {
      const participant = await Participant.findOne({ rallyId: sheet.rallyId, eq })
        .select('eq')
        .lean();

      if (!participant) {
        return NextResponse.json(
          {
            error:
              `EQ ${eq} is not a participant of this rally. ` +
              'Import the entry list first.',
          },
          { status: 400 }
        );
      }
    }

    const stage = await Stage.findById(sheet.stageId);
    // Resolved before parsing: how many rows a sheet may hold depends on the
    // stage's `usesSecondCard` (see "Second answer card" in CLAUDE.md). A
    // sheet whose stage was since deleted falls back to one card's worth,
    // the same as a stage that never opted in.
    const orcCap = stage?.usesSecondCard ? ORC_ROWS_PER_CARD * 2 : ORC_ROWS_PER_CARD;
    const merkCap = stage?.usesSecondCard ? MERK_ROWS_PER_CARD * 2 : MERK_ROWS_PER_CARD;
    const answers =
      body.answers !== undefined ? parseAnswerRows(body.answers, orcCap) : sheet.answers;

    const previousEq = sheet.eq;
    if (eq !== null) sheet.eq = eq;
    sheet.answers = answers;
    if (body.timePenalties !== undefined) {
      // Only the WPT survives the parse; the rescore below recomputes the rest.
      sheet.timePenalties = parseTimePenalties(body.timePenalties);
    }
    if (body.merkScores !== undefined) {
      // Only the letters survive the parse; the rescore below scores the column.
      sheet.merkScores = parseMerkScores(body.merkScores, merkCap);
    }
    if (diversenCount !== null) sheet.diversenCount = diversenCount;
    const merkPenalty = calculateMerkPenalty(
      stage ? stage.merkScoreKey : [],
      sheet.merkScores,
      sheet.diversenCount
    ).totalPenalty;
    sheet.merkPenalty = merkPenalty;
    // ORC's + merk; rescoreParticipants adds the time part below.
    sheet.totalPenalty =
      calculateTotalPenalty(stage ? stage.scoreKey : [], answers) + merkPenalty;

    // An official changed the card: the offline workspace's copy of it is out
    // of date from here on (see "Offline mode" in CLAUDE.md).
    sheet.$inc('revision', 1);

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
  const session = await requireSession();
  if (!session.ok) return session.response;

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
