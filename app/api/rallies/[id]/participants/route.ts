import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/mongodb';
import { Participant, Rally } from '../../../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../../../lib/api-guard';
import { duplicateCrewMessage, readCrew } from '../../../../lib/crewRegistration';
import { parseEq } from '../../../../lib/validation';
import mongoose from 'mongoose';

// The participants of a rally: which **crew** rides under which EQ number.
//
// A crew is two registered riders — a driver and a navigator (see
// `app/lib/crewRegistration.ts`) — plus the car they brought. The class they
// ride in is derived from the two of them and never sent by the client.
//
// A participant record is still optional: an EQ with answer sheets but no
// record is scored exactly as before, it just has no crew attached. So is an
// entry with no riders yet, which is what an entry-list import produces before
// anybody has been registered — such an entry is scored in its own rally and
// is simply not part of a season, because a season is awarded to a pair of
// named people.

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

  const crew = await readCrew(body);
  if (!crew.ok) {
    return NextResponse.json({ error: crew.error }, { status: 400 });
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

    const participant = new Participant({ rallyId: id, eq, ...crew.crew });

    const saved = await participant.save();

    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    // Three unique indexes can refuse this: the EQ is taken, or one of the two
    // riders is already in another car in this rally. `duplicateCrewMessage`
    // reads which, because "already entered" pointing at the wrong field sends
    // an official looking in the wrong place.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json({ error: duplicateCrewMessage(error) }, { status: 409 });
    }

    console.error('Failed to create participant:', error);
    return NextResponse.json({ error: 'Failed to create participant' }, { status: 500 });
  }
}
