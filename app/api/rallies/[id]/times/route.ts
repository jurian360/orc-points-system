import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../lib/mongodb';
import { AnswerSheet, Participant, Rally } from '../../../../models';
import { requireSession } from '../../../../lib/api-guard';
import { loadRunningOrder } from '../../../../lib/rallyOrder';
import { TIME_ROWS, parseClock, timeRowKind, timeRowLabel } from '../../../../lib/timeScoring';
// The shape of the response lives with the other shared interfaces, so this
// route and the panel that reads it (app/components/RallyTimesPanel.tsx) cannot
// drift apart.
import type {
  RallyTimeCell,
  RallyTimeColumn,
  RallyTimeEntry,
  RallyTimes,
} from '../../../../types';

// GET /api/rallies/[id]/times — the WPT overview of a whole rally.
//
// The time column of one card is on that card; this is the other way round:
// every control of every stage, with the time each crew passed it. It is what
// an official reads after a GTC has handed its export in — did every crew get a
// time, and which of them are outside their window — without opening 56 cards.
//
// Nothing is scored here. The rows on a sheet were computed and stored when the
// sheet was written (app/lib/rescore.ts), so this route only reads them: the
// overview and the card show the same numbers because they are the same
// numbers.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
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

    // Running order, the same order the stage list and the re-scoring use: the
    // delta runs through the stages in this order — starting again at every
    // route boundary — so the overview has to read left to right in it too, and
    // it carries the rally's routes so the grid can head a block of stages with
    // the leg they are ridden in.
    const [order, participants, sheets] = await Promise.all([
      loadRunningOrder(id, '_id name timeScoreKey'),
      Participant.find({ rallyId: id }).sort({ eq: 1 }),
      AnswerSheet.find({ rallyId: id }).select(
        'eq stageId timePenalties timePenalty disqualified startDelta endDelta'
      ),
    ]);

    const { stages, routes } = order;

    const sheetsByStage = new Map<string, any[]>();
    for (const sheet of sheets) {
      const key = String(sheet.stageId);
      const group = sheetsByStage.get(key) || [];
      group.push(sheet);
      sheetsByStage.set(key, group);
    }

    // Every EQ that is part of this rally: the crews on the entry list, plus an
    // EQ that only exists as a sheet — a card typed before anybody recorded who
    // rides under that number still has times to show.
    const eqs = new Set<number>(participants.map((participant: any) => participant.eq));
    for (const sheet of sheets) eqs.add(sheet.eq);
    const orderedEqs = Array.from(eqs).sort((a, b) => a - b);

    const stageTables = stages.map((stage: any) => {
      const stageSheets = sheetsByStage.get(String(stage._id)) || [];
      const sheetByEq = new Map<number, any>(stageSheets.map((sheet: any) => [sheet.eq, sheet]));

      const key = stage.timeScoreKey || [];

      const columns: RallyTimeColumn[] = Array.from({ length: TIME_ROWS }, (_, index) => {
        const rowNumber = index + 1;
        const ipt0 = (key.find((row: any) => row.rowNumber === rowNumber)?.ipt || '').trim();
        return {
          rowNumber,
          label: timeRowLabel(rowNumber),
          kind: timeRowKind(rowNumber),
          ipt0,
          // A row with no usable IPT 0 is not a checkpoint of this stage. The
          // overview still carries it, because a time import can have written a
          // WPT on a row whose IPT the stage key never got — that is exactly the
          // mistake this page should show rather than hide.
          active: parseClock(ipt0) !== null,
        };
      });

      const entries: RallyTimeEntry[] = orderedEqs.map((eq) => {
        const sheet = sheetByEq.get(eq);
        const rows: any[] = sheet?.timePenalties || [];

        const cells: RallyTimeCell[] = columns.map((column) => {
          const row = rows.find((entry: any) => entry.rowNumber === column.rowNumber);
          return {
            rowNumber: column.rowNumber,
            ipt: row?.ipt || '',
            wpt: row?.wpt || '',
            plusMinus: row?.plusMinus || '',
            strafp: row?.strafp || 0,
            outOfWindow: Boolean(row?.outOfWindow),
            missing: Boolean(row?.missing),
          };
        });

        return {
          eq,
          hasSheet: Boolean(sheet),
          timePenalty: sheet?.timePenalty || 0,
          disqualified: Boolean(sheet?.disqualified),
          startDelta: sheet?.startDelta || 0,
          endDelta: sheet?.endDelta || 0,
          cells,
        };
      });

      return {
        _id: String(stage._id),
        name: stage.name,
        routeId: stage.routeId ? String(stage.routeId) : null,
        columns,
        entries,
      };
    });

    const payload: RallyTimes = {
      rally: { _id: String(rally._id), name: rally.name },
      // The rally's legs, in the order they are ridden. Empty on a rally with no
      // routes, so the grid draws the two header rows it always drew.
      routes: routes.map((route: any) => ({ _id: String(route._id), name: route.name })),
      stages: stageTables,
      participants: participants.map((participant: any) => ({
        eq: participant.eq,
        classification: participant.classification || '',
        driverName: participant.driverName || '',
        navigatorName: participant.navigatorName || '',
      })),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Failed to fetch rally times:', error);
    return NextResponse.json({ error: 'Failed to fetch rally times' }, { status: 500 });
  }
}
