import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../../lib/mongodb';
import { Participant, Rally } from '../../../../../models';
import { readBody, requireRallyAdmin } from '../../../../../lib/api-guard';
import { CLASSIFICATION_LIST } from '../../../../../lib/participants';
import {
  MAX_IMPORT_PARTICIPANTS,
  parseClassification,
  parseEq,
  parseOptionalName,
} from '../../../../../lib/validation';
import mongoose from 'mongoose';

// POST /api/rallies/[id]/participants/import
//
// The entry list of a rally in one write. The spreadsheet itself is read in the
// browser (app/lib/spreadsheet.ts) and only the mapped rows arrive here, so this
// stays an ordinary JSON route behind the 256 KB object-only body guard — no
// file upload path, no parser on the server.
//
// All or nothing: one unusable row rejects the whole request. A half-imported
// entry list is worse than none, because the officials cannot see where it
// stopped. Rows are upserted on {rallyId, eq}, so re-importing a corrected sheet
// updates the crews instead of colliding with them.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const rows = parsed.body.participants;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: 'The import is empty — there are no participants to save' },
      { status: 400 }
    );
  }

  // A rally has at most 100 EQ numbers, so anything beyond that is either a
  // mis-mapped column or an attempt to make the server do pointless work.
  if (rows.length > MAX_IMPORT_PARTICIPANTS) {
    return NextResponse.json(
      { error: `An import holds at most ${MAX_IMPORT_PARTICIPANTS} participants` },
      { status: 400 }
    );
  }

  // Every value is proven to be a scalar of the right shape before it reaches a
  // query — the client-side preview is a convenience, not a guard.
  const participants: {
    eq: number;
    classification: string;
    driverName: string;
    navigatorName: string;
  }[] = [];
  const seen = new Set<number>();

  for (const [index, row] of rows.entries()) {
    const raw = (row ?? {}) as Record<string, unknown>;
    const position = index + 1;

    const eq = parseEq(raw.eq);
    if (eq === null) {
      return NextResponse.json(
        { error: `Row ${position}: eq must be an integer between 1 and 100` },
        { status: 400 }
      );
    }

    if (seen.has(eq)) {
      return NextResponse.json(
        { error: `Row ${position}: EQ ${eq} appears more than once in this import` },
        { status: 400 }
      );
    }
    seen.add(eq);

    const classification = parseClassification(raw.classification);
    if (classification === null) {
      return NextResponse.json(
        { error: `Row ${position}: classification must be one of ${CLASSIFICATION_LIST}` },
        { status: 400 }
      );
    }

    const driverName = parseOptionalName(raw.driverName);
    const navigatorName = parseOptionalName(raw.navigatorName);
    if (driverName === null || navigatorName === null) {
      return NextResponse.json(
        { error: `Row ${position}: names must be text of at most 200 characters` },
        { status: 400 }
      );
    }

    participants.push({ eq, classification, driverName, navigatorName });
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

    const now = new Date();
    const result = await Participant.bulkWrite(
      participants.map((participant) => ({
        updateOne: {
          filter: { rallyId: id, eq: participant.eq },
          update: {
            $set: {
              classification: participant.classification,
              driverName: participant.driverName,
              navigatorName: participant.navigatorName,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      }))
    );

    // Nothing is re-scored: a participant record carries no points, so the
    // standings only gain the names they show next to the EQ numbers.
    return NextResponse.json({
      message: 'Participants imported successfully',
      total: participants.length,
      created: result.upsertedCount ?? 0,
      updated: result.matchedCount ?? 0,
    });
  } catch (error) {
    console.error('Failed to import participants:', error);
    return NextResponse.json({ error: 'Failed to import participants' }, { status: 500 });
  }
}
