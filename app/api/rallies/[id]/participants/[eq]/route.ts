import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../../lib/mongodb';
import { AnswerSheet, Rally } from '../../../../../models';
import { requireSession } from '../../../../../lib/api-guard';
import { parseEqParam } from '../../../../../lib/validation';
import mongoose from 'mongoose';

// DELETE /api/rallies/[id]/participants/[eq]
//
// Removes a participant from a rally: there are no participant records, a
// participant *is* their answer sheets, so this deletes every sheet they have in
// this rally. Their sheets in other rallies are untouched.
//
// No re-scoring is needed afterwards: a participant's time delta chains through
// their own stages only, so dropping one participant cannot move anyone else's
// total.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eq: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const { id, eq: eqParam } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    // Proving eq is a scalar integer is what keeps `{"$gt": 0}` — which would
    // wipe every participant of the rally — out of the delete filter.
    const eq = parseEqParam(eqParam);
    if (eq === null) {
      return NextResponse.json(
        { error: 'eq must be an integer between 1 and 100' },
        { status: 400 }
      );
    }

    await dbConnect();

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const result = await AnswerSheet.deleteMany({ rallyId: id, eq });

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'This participant has no answer sheets in this rally' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Participant deleted successfully',
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Failed to delete participant:', error);
    return NextResponse.json({ error: 'Failed to delete participant' }, { status: 500 });
  }
}
