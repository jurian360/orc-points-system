import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/mongodb';
import { Rally, Stage, AnswerSheet } from '../../../../models';
import { requireSession } from '../../../../lib/api-guard';
import mongoose from 'mongoose';

// Returns the rally standings: one entry per participant (eq), with the total
// penalty summed across all of that participant's answer sheets in the rally.
// Ranked ascending — the lowest total penalty is the winner.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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

    const totalStages = await Stage.countDocuments({ rallyId: id });
    const sheets = await AnswerSheet.find({ rallyId: id });

    // Aggregate penalties per participant. `totalPenalty` on a sheet already
    // covers the ORC's and the time part; the time part is carried separately so
    // the table can show where the points came from.
    const byParticipant = new Map<
      number,
      {
        eq: number;
        totalPenalty: number;
        timePenalty: number;
        sheetsSubmitted: number;
        disqualified: boolean;
      }
    >();

    for (const sheet of sheets) {
      const existing = byParticipant.get(sheet.eq) || {
        eq: sheet.eq,
        totalPenalty: 0,
        timePenalty: 0,
        sheetsSubmitted: 0,
        disqualified: false,
      };
      existing.totalPenalty += sheet.totalPenalty || 0;
      existing.timePenalty += sheet.timePenalty || 0;
      existing.sheetsSubmitted += 1;
      existing.disqualified = existing.disqualified || Boolean(sheet.disqualified);
      byParticipant.set(sheet.eq, existing);
    }

    // A disqualified participant is ranked behind everyone still in the rally,
    // whatever their points.
    const standings = Array.from(byParticipant.values())
      .sort(
        (a, b) =>
          Number(a.disqualified) - Number(b.disqualified) ||
          a.totalPenalty - b.totalPenalty ||
          a.eq - b.eq
      )
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    return NextResponse.json({ totalStages, standings });
  } catch (error) {
    console.error('Failed to compute standings:', error);
    return NextResponse.json({ error: 'Failed to compute standings' }, { status: 500 });
  }
}
