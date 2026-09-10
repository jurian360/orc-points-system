import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/mongodb';
import { Participant, Rally } from '../../../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../../../lib/api-guard';
import { CLASSIFICATION_LIST } from '../../../../lib/participants';
import {
  parseClassification,
  parseEq,
  parseOptionalName,
} from '../../../../lib/validation';
import mongoose from 'mongoose';

// The participants of a rally: who rides under which EQ number, and in which
// class. A participant record is optional — an EQ with answer sheets but no
// record is still scored, it just has no name attached — so this collection is
// a lookup table beside the sheets, never a precondition for entering one.

// GET /api/rallies/[id]/participants — every participant record of the rally,
// in EQ order.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const participants = await Participant.find({ rallyId: id }).sort({ eq: 1 });
    return NextResponse.json(participants);
  } catch (error) {
    console.error('Failed to fetch participants:', error);
    return NextResponse.json({ error: 'Failed to fetch participants' }, { status: 500 });
  }
}

// POST /api/rallies/[id]/participants — add a participant to the rally.
//
// Creating only: an EQ that already has a record is a 409 rather than an
// overwrite, so typing an EQ that is already taken warns the official instead of
// silently replacing another crew's details. Use PUT on the [eq] route to change
// an existing one.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  // Proving eq is a scalar integer is what keeps `{"$gt": 0}` out of the query
  // below and out of the unique index.
  const eq = parseEq(body.eq);
  if (eq === null) {
    return NextResponse.json(
      { error: 'eq must be an integer between 1 and 100' },
      { status: 400 }
    );
  }

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
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const participant = new Participant({
      rallyId: id,
      eq,
      classification,
      driverName,
      navigatorName,
    });

    const saved = await participant.save();

    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    // The unique {rallyId, eq} index is the authoritative guard here.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'This rally already has a participant with this EQ number' },
        { status: 409 }
      );
    }

    console.error('Failed to create participant:', error);
    return NextResponse.json({ error: 'Failed to create participant' }, { status: 500 });
  }
}
