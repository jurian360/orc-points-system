import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/mongodb';
import { Participant, Person, Rally } from '../../../../models';
import { readBody, requireClassificationAdmin } from '../../../../lib/api-guard';
import { toPersonDetail } from '../../../../lib/riderResults';
import {
  CLASSIFICATION_LIST,
  crewClassification,
  type ClassificationValue,
} from '../../../../lib/participants';
import { parseClassification, parseObjectId } from '../../../../lib/validation';
import mongoose from 'mongoose';

// PUT /api/persons/[id]/classification — set the class a rider rides in.
//
// Its own route, rather than a field on `PUT /api/persons/[id]`, for two
// reasons that are really the same one:
//
//   * It is the **only** thing a classification admin may change, and a guard
//     is a poor place to express "this field but not those". A route each is.
//   * It is not an overwrite. Every change appends to the rider's
//     `classificationHistory` with the day it happened and the official who
//     made it, because the question that always follows a promotion is when
//     they were moved up and by whom.
//
// A save that does not actually change the class writes nothing — no history
// entry, no new timestamp. The history is what happened to the rider, not a
// log of who opened the form.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireClassificationAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const classification = parseClassification(parsed.body.classification);
  if (classification === null) {
    return NextResponse.json(
      { error: `Classification must be one of ${CLASSIFICATION_LIST}` },
      { status: 400 }
    );
  }

  try {
    const { id } = await params;
    const personId = parseObjectId(id);
    if (!personId) return NextResponse.json({ error: 'Invalid rider id' }, { status: 400 });

    await dbConnect();

    const person = await Person.findById(personId);
    if (!person) return NextResponse.json({ error: 'Rider not found' }, { status: 404 });

    const previous = person.classification || '';

    if (previous === classification) {
      return NextResponse.json(toPersonDetail(person.toObject()));
    }

    const now = new Date();

    person.classification = classification;
    person.classificationChangedAt = now;
    person.classificationHistory.push({
      from: previous,
      to: classification,
      changedAt: now,
      changedBy: session.user.username,
    });
    person.updatedAt = now;

    await person.save();

    await applyToUnriddenEntries(personId, classification, now);

    return NextResponse.json(toPersonDetail(person.toObject()));
  } catch (error) {
    console.error('Failed to change the classification:', error);
    return NextResponse.json(
      { error: 'Failed to change the classification' },
      { status: 500 }
    );
  }
}

// Bring the rider's **upcoming** entries into line with their new class.
//
// An entry stores the class its crew rode in, snapshotted at registration, and
// that snapshot is deliberately not rewritten wholesale: a promotion in August
// must not restate what a crew won in March. But a rally that has not been
// ridden yet has nothing to restate — a rider promoted on the Thursday rides
// Sunday's rally in their new class, and an entry that still said otherwise
// would put their crew on the wrong result sheet.
//
// "Not ridden yet" is read off the rally's date, which is the field that says
// when it is. A rally with no date at all predates this whole feature and is
// left alone rather than guessed about.
async function applyToUnriddenEntries(
  personId: string,
  classification: ClassificationValue,
  now: Date
): Promise<void> {
  // Midnight of the day the change was made: a rally ridden *today* is in
  // progress or done, so it keeps the class its crews started under.
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  const upcoming = (await Rally.find({ date: { $gt: today } }, '_id').lean()) as unknown as {
    _id: unknown;
  }[];

  if (upcoming.length === 0) return;

  // `mongoose.trusted`: `sanitizeFilter` (app/lib/mongodb.ts) would wrap the
  // `$in` in an `$eq` and fail to cast it. These ids are the rallies read a
  // line above, not anything off the wire.
  const entries = await Participant.find({
    rallyId: mongoose.trusted({ $in: upcoming.map((rally) => rally._id) }),
    $or: [{ driverId: personId }, { navigatorId: personId }],
  });

  // A handful of entries at most — one rider is in one car per rally, and
  // there are never many rallies ahead — so each is re-derived and saved on
  // its own rather than through a bulk write whose filter would have to
  // re-state the crew rule. The *other* seat's class is already on the entry,
  // so nothing has to be looked up: only this rider's half moved.
  for (const entry of entries) {
    const isDriver = String(entry.driverId) === personId;

    if (isDriver) entry.driverClassification = classification;
    else entry.navigatorClassification = classification;

    entry.classification = crewClassification(
      entry.driverClassification || '',
      entry.navigatorClassification || ''
    );
    entry.updatedAt = now;

    await entry.save();
  }
}
