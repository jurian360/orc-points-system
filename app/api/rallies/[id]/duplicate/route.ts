import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../lib/mongodb';
import { Rally, Stage } from '../../../../models';
import { requireRallyAdmin } from '../../../../lib/api-guard';
import {
  copyRallyCode,
  copyRallyName,
  parseRallyCode,
  slugFromName,
} from '../../../../lib/rallyCodes';

// POST /api/rallies/[id]/duplicate
//
// A new rally with the stages and the answer keys of this one, named
// "<name>-copy". Rallies are run to the same route year after year: the keys,
// the timetable and the time settings are the work, and typing them again is
// what this route saves.
//
// What is copied is the *setup* — the stages in their running order, with their
// scoreKey, timeScoreKey, merkScoreKey and timeConfig. What is deliberately not
// copied is everything that belongs to a running of it: the entry list, the
// answer sheets and the printed QR codes. A duplicate is a rally waiting for its
// crews, not a second copy of last year's results.
//
// It takes no body: the rally in the path is the whole request.

// How many codes to try before giving up. The first is "<code>-COPY"; a rally
// that already holds it gets counted out and the next one is tried.
const CODE_ATTEMPTS = 10;

// A stage's key as it goes onto the copy. Mongoose gives every subdocument an
// `_id`; the copy gets its own, so they are stripped rather than carried over.
// Dates are values here, not objects to walk into.
function withoutIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => withoutIds(entry)) as T;
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === '_id') continue;
      copy[key] = withoutIds(entry);
    }
    return copy as T;
  }
  return value;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const source = await Rally.findById(id);
    if (!source) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const name = copyRallyName(source.name);
    // A rally that pre-dates the codes has none to build on, so the copy starts
    // from what its own name would suggest — the same fallback POST /api/rallies
    // makes for a rally created without one.
    const base = parseRallyCode(source.code) || slugFromName(name);

    let duplicate = null;

    for (let attempt = 0; attempt < CODE_ATTEMPTS && !duplicate; attempt++) {
      const code = parseRallyCode(copyRallyCode(base, attempt));
      // Only possible if the source code was something the pattern rejects,
      // which the unique index and `parseRallyCode` on the write paths already
      // rule out — but a code that cannot be parsed must never reach the query.
      if (!code) break;

      try {
        duplicate = await new Rally({ name, code }).save();
      } catch (error) {
        // Another rally already answers to this code: try the next marker
        // rather than making a submission from the app ambiguous.
        if (error instanceof Error && 'code' in error && error.code === 11000) continue;
        throw error;
      }
    }

    if (!duplicate) {
      return NextResponse.json(
        { error: 'Could not find a free rally code for the duplicate. Rename the original first.' },
        { status: 409 }
      );
    }

    // Running order is creation order (app/lib/rescore.ts sorts identically), so
    // the copies are stamped one millisecond apart in the order they are read.
    // Letting them all default to `Date.now()` would leave the order of the copy
    // to the `_id` tie-break; this makes it the order of the original.
    const stages = await Stage.find({ rallyId: id }).sort({ createdAt: 1, _id: 1 });
    const stamp = Date.now();

    const copies = stages.map((stage: any, index: number) => {
      const plain = stage.toObject();
      return {
        rallyId: duplicate._id,
        name: plain.name,
        // The stable card number the Android app resolves a submission by. It is
        // unique within a rally, and the copy is a different rally with a
        // different code, so keeping it lines the two up card for card.
        cardId: plain.cardId,
        createdAt: new Date(stamp + index),
        scoreKey: withoutIds(plain.scoreKey || []),
        timeScoreKey: withoutIds(plain.timeScoreKey || []),
        merkScoreKey: withoutIds(plain.merkScoreKey || []),
        timeConfig: withoutIds(plain.timeConfig || {}),
      };
    });

    if (copies.length > 0) {
      await Stage.insertMany(copies);
    }

    // Nothing to re-score: the duplicate has no sheets, because it has no crews.
    return NextResponse.json(
      {
        rally: duplicate,
        stages: copies.length,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to duplicate rally:', error);
    return NextResponse.json({ error: 'Failed to duplicate rally' }, { status: 500 });
  }
}
