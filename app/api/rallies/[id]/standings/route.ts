import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/mongodb';
import { Rally, Stage, AnswerSheet, Participant } from '../../../../models';
import { requireSession } from '../../../../lib/api-guard';
import mongoose from 'mongoose';

// Returns the rally standings: one entry per participant (eq), with the total
// penalty summed across all of that participant's answer sheets in the rally.
// Ranked ascending — the lowest total penalty is the winner.
//
// Each entry splits its total into the ORC's (letters) and the Tijd (time) part,
// so the standings show where a crew lost their points.
//
// Each entry also carries the participant's class and crew names when they have
// been recorded, so the table can show who an EQ is. Only participants with
// sheets are ranked: a registered crew that has not handed in a card yet has no
// score to rank, and would otherwise lead the standings on zero points.
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
    const participants = await Participant.find({ rallyId: id });

    const detailsByEq = new Map<
      number,
      { classification?: string; driverName?: string; navigatorName?: string }
    >(participants.map((participant) => [participant.eq, participant]));

    // Aggregate penalties per participant. `totalPenalty` on a sheet already
    // covers the ORC's and the time part; both parts are carried separately so
    // the table can show where the points came from. The ORC's part is what is
    // left of the stored total after the stored time part — the two are written
    // together by app/lib/rescore.ts, so no sheet has to be re-scored here.
    const byParticipant = new Map<
      number,
      {
        eq: number;
        totalPenalty: number;
        orcPenalty: number;
        timePenalty: number;
        sheetsSubmitted: number;
        disqualified: boolean;
      }
    >();

    for (const sheet of sheets) {
      const existing = byParticipant.get(sheet.eq) || {
        eq: sheet.eq,
        totalPenalty: 0,
        orcPenalty: 0,
        timePenalty: 0,
        sheetsSubmitted: 0,
        disqualified: false,
      };
      const totalPenalty = sheet.totalPenalty || 0;
      const timePenalty = sheet.timePenalty || 0;
      existing.totalPenalty += totalPenalty;
      existing.orcPenalty += totalPenalty - timePenalty;
      existing.timePenalty += timePenalty;
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
      .map((entry, index) => {
        const details = detailsByEq.get(entry.eq);
        return {
          ...entry,
          classification: details?.classification || '',
          driverName: details?.driverName || '',
          navigatorName: details?.navigatorName || '',
          rank: index + 1,
        };
      });

    return NextResponse.json({ totalStages, standings });
  } catch (error) {
    console.error('Failed to compute standings:', error);
    return NextResponse.json({ error: 'Failed to compute standings' }, { status: 500 });
  }
}
