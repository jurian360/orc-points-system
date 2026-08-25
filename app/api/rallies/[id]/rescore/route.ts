import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/mongodb';
import { AnswerSheet, Rally } from '../../../../models';
import { requireRallyAdmin } from '../../../../lib/api-guard';
import { rescoreRally } from '../../../../lib/rescore';
import mongoose from 'mongoose';

// POST /api/rallies/[id]/rescore
//
// Re-scores every sheet of a rally from the current stage keys: the ORC's
// penalty of each sheet, the whole time chain of each participant and the
// disqualifications that follow from it.
//
// Writing a stage or a sheet already re-scores what it touches (see
// app/lib/rescore.ts), so this route is not what keeps the standings correct
// day to day. It is the officials' way to force the recomputation when
// something outside those write paths changed — a scoring rule that shipped
// after the sheets were typed, or a document edited straight in the database.
// It takes no body: the rally in the path is the whole request.
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

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    await rescoreRally(id);

    const sheets = await AnswerSheet.countDocuments({ rallyId: id });

    return NextResponse.json({ message: 'Scores recalculated', sheets });
  } catch (error) {
    console.error('Failed to recalculate scores:', error);
    return NextResponse.json({ error: 'Failed to recalculate scores' }, { status: 500 });
  }
}
