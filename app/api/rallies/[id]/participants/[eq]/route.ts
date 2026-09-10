import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../../lib/mongodb';
import { AnswerSheet, Participant, Rally } from '../../../../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../../../../lib/api-guard';
import { CLASSIFICATION_LIST } from '../../../../../lib/participants';
import {
  parseClassification,
  parseEqParam,
  parseOptionalName,
} from '../../../../../lib/validation';
import mongoose from 'mongoose';

// One participant of a rally, addressed by their EQ number.
//
// Every handler here proves `eq` is a scalar integer before it reaches a query:
// `{"$gt": 0}` in this position would read — or, on DELETE, wipe — every
// participant of the rally.
type ParamsResult = { ok: true; eq: number } | { ok: false; response: NextResponse };

function readParams(id: string, eqParam: string): ParamsResult {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 }),
    };
  }

  const eq = parseEqParam(eqParam);
  if (eq === null) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'eq must be an integer between 1 and 100' },
        { status: 400 }
      ),
    };
  }

  return { ok: true, eq };
}

// GET /api/rallies/[id]/participants/[eq]
//
// The details of one participant. A 404 means this EQ has no record yet, not
// that it is unknown to the rally — it may well have answer sheets.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eq: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const { id, eq: eqParam } = await params;

    const parsedParams = readParams(id, eqParam);
    if (!parsedParams.ok) return parsedParams.response;
    const { eq } = parsedParams;

    await dbConnect();

    const participant = await Participant.findOne({ rallyId: id, eq });
    if (!participant) {
      return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
    }

    return NextResponse.json(participant);
  } catch (error) {
    console.error('Failed to fetch participant:', error);
    return NextResponse.json({ error: 'Failed to fetch participant' }, { status: 500 });
  }
}

// PUT /api/rallies/[id]/participants/[eq]
//
// Save the class and the crew of this EQ. Upserts on purpose: a participant
// usually exists as answer sheets long before anybody types their names, so
// saving details for an EQ that has no record yet has to create one.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eq: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  const classification = parseClassification(body.classification);
  if (classification === null) {
    return NextResponse.json(
      { error: `Classification must be one of ${CLASSIFICATION_LIST}` },
      { status: 400 }
    );
  }

  const driverName = parseOptionalName(body.driverName);
  const navigatorName = parseOptionalName(body.navigatorName);
  if (driverName === null || navigatorName === null) {
    return NextResponse.json(
      { error: 'Names must be text of at most 200 characters' },
      { status: 400 }
    );
  }

  try {
    const { id, eq: eqParam } = await params;

    const parsedParams = readParams(id, eqParam);
    if (!parsedParams.ok) return parsedParams.response;
    const { eq } = parsedParams;

    await dbConnect();

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    // `rallyId` and `eq` come from the filter on insert, so they are not
    // repeated in the update document.
    const participant = await Participant.findOneAndUpdate(
      { rallyId: id, eq },
      {
        $set: { classification, driverName, navigatorName, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { new: true, upsert: true, runValidators: true }
    );

    return NextResponse.json(participant);
  } catch (error) {
    // Two officials saving the same new participant at once: the unique index
    // lets one insert win and turns the other into a duplicate-key error.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'This participant was just added by someone else — reload and try again' },
        { status: 409 }
      );
    }

    console.error('Failed to save participant:', error);
    return NextResponse.json({ error: 'Failed to save participant' }, { status: 500 });
  }
}

// DELETE /api/rallies/[id]/participants/[eq]
//
// Removes a participant from a rally: their details record and every answer
// sheet they have in this rally. Their sheets in other rallies are untouched.
//
// No re-scoring is needed afterwards: a participant's time delta chains through
// their own stages only, so dropping one participant cannot move anyone else's
// total.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eq: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  try {
    const { id, eq: eqParam } = await params;

    const parsedParams = readParams(id, eqParam);
    if (!parsedParams.ok) return parsedParams.response;
    const { eq } = parsedParams;

    await dbConnect();

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const [sheetResult, participantResult] = await Promise.all([
      AnswerSheet.deleteMany({ rallyId: id, eq }),
      Participant.deleteOne({ rallyId: id, eq }),
    ]);

    // Neither sheets nor a record: this EQ was never part of the rally.
    if (sheetResult.deletedCount === 0 && participantResult.deletedCount === 0) {
      return NextResponse.json(
        { error: 'This participant is not part of this rally' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Participant deleted successfully',
      deletedCount: sheetResult.deletedCount,
    });
  } catch (error) {
    console.error('Failed to delete participant:', error);
    return NextResponse.json({ error: 'Failed to delete participant' }, { status: 500 });
  }
}
