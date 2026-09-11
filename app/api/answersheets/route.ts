import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { AnswerSheet, Participant, Stage } from '../../models';
import { calculateMerkPenalty, calculateTotalPenalty } from '../../lib/scoring';
import { readBody, requireSession } from '../../lib/api-guard';
import { rescoreParticipants } from '../../lib/rescore';
import {
  MERK_ROWS_PER_CARD,
  ORC_ROWS_PER_CARD,
  parseAnswerRows,
  parseEq,
  parseEqParam,
  parseMerkScores,
  parseTimePenalties,
} from '../../lib/validation';
import mongoose from 'mongoose';

// GET /api/answersheets?stageId=... or ?rallyId=... (optionally &eq=...)
// Returns answer sheets filtered by stage or rally.
export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  // Validate before touching the database: invalid input should cost a 400,
  // not a connection.
  const { searchParams } = new URL(request.url);
  const stageId = searchParams.get('stageId');
  const rallyId = searchParams.get('rallyId');
  const eqParam = searchParams.get('eq');

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

  if (eqParam !== null) {
    // Previously `Number(eq)`, which produced NaN for junk input and
    // surfaced a Mongoose CastError as a 500.
    const eq = parseEqParam(eqParam);
    if (eq === null) {
      return NextResponse.json(
        { error: 'eq must be an integer between 1 and 100' },
        { status: 400 }
      );
    }
    query.eq = eq;
  }

  try {
    await dbConnect();

    const sheets = await AnswerSheet.find(query).sort({ submittedAt: -1 });
    return NextResponse.json(sheets);
  } catch (error) {
    console.error('Failed to fetch answer sheets:', error);
    return NextResponse.json({ error: 'Failed to fetch answer sheets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  const stageId = body.stageId;
  if (typeof stageId !== 'string' || !mongoose.Types.ObjectId.isValid(stageId)) {
    return NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 });
  }

  // Proving eq is a scalar integer is what closes the operator-injection hole
  // in the duplicate check below — `{"$gt": 0}` previously reached the query.
  const eq = parseEq(body.eq);
  if (eq === null) {
    return NextResponse.json(
      { error: 'eq must be an integer between 1 and 100' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    // Loaded before `answers`/`merkScores` are parsed — unlike the cheaper
    // checks above, how many rows a sheet may hold depends on this stage's
    // `usesSecondCard`, so there is no parsing them without it. See "Second
    // answer card" in CLAUDE.md.
    const stage = await Stage.findById(stageId);
    if (!stage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    const orcCap = stage.usesSecondCard ? ORC_ROWS_PER_CARD * 2 : ORC_ROWS_PER_CARD;
    const merkCap = stage.usesSecondCard ? MERK_ROWS_PER_CARD * 2 : MERK_ROWS_PER_CARD;
    const answers = parseAnswerRows(body.answers, orcCap);
    const merkScores = parseMerkScores(body.merkScores, merkCap);

    // A sheet belongs to a crew, not to a bare number: the entry list is what
    // says who is riding, so an EQ with no `Participant` record is refused
    // rather than scored — the same guard the time import applies. It is what
    // keeps a mistyped number from opening a card nobody rides under.
    const participant = await Participant.findOne({ rallyId: stage.rallyId, eq })
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

    // A participant may only submit one sheet per stage.
    const existing = await AnswerSheet.findOne({ eq, stageId });

    if (existing) {
      return NextResponse.json(
        { error: 'This participant already has an answer sheet for this stage' },
        { status: 400 }
      );
    }

    const merkPenalty = calculateMerkPenalty(stage.merkScoreKey, merkScores).totalPenalty;

    const answerSheet = new AnswerSheet({
      eq,
      rallyId: stage.rallyId,
      stageId,
      answers,
      timePenalties: parseTimePenalties(body.timePenalties),
      merkScores,
      merkPenalty,
      // ORC's + merk; rescoreParticipants adds the time part below.
      totalPenalty: calculateTotalPenalty(stage.scoreKey, answers) + merkPenalty,
    });

    const savedSheet = await answerSheet.save();

    // The time penalties of this sheet — and of every later stage of this
    // participant — depend on the delta they carry through the rally, so they
    // are computed from the stage time keys after the insert.
    await rescoreParticipants(stage.rallyId, [eq]);

    const scoredSheet = await AnswerSheet.findById(savedSheet._id);

    return NextResponse.json(scoredSheet || savedSheet, { status: 201 });
  } catch (error) {
    // The unique {stageId, eq} index is the authoritative guard against the
    // check-then-insert race above.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'This participant already has an answer sheet for this stage' },
        { status: 409 }
      );
    }

    console.error('Failed to save answer sheet:', error);
    return NextResponse.json({ error: 'Failed to save answer sheet' }, { status: 500 });
  }
}
