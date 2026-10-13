import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import dbConnect from '../../../../lib/mongodb';
import { AnswerSheet, Participant, Rally, Stage } from '../../../../models';
import { requireSession } from '../../../../lib/api-guard';
import { ORC_ROWS_PER_CARD, parseObjectId } from '../../../../lib/validation';
import {
  calculateRowPenalty,
  hasOrderError,
  type ScoreKeyRow,
} from '../../../../lib/scoring';
import type {
  RowReport,
  RowReportAnswerGroup,
  RowReportEntry,
} from '../../../../types';

// GET /api/stages/[id]/row-report?row=N — how the field answered one ORC row.
//
// For one row of one stage: how many crews were charged on it, which answers
// were given most, and what every crew wrote. It is what officials read when a
// row looks suspicious — a key with a typo, or a question the whole field read
// the same "wrong" way — before they decide to correct the key or uphold an
// appeal.
//
// Nothing is stored and nothing new is scored: every penalty comes from
// calculateRowPenalty over the stage's key, the same function the card, the
// entry form and the re-score use, so this report cannot disagree with them.
// It is a read, so its guard is requireSession(): a data-entry official reads
// the cards it is made of anyway.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const { id } = await params;
    const stageId = parseObjectId(id);
    if (!stageId) {
      return NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 });
    }

    const stage = await Stage.findById(stageId).select('rallyId name scoreKey usesSecondCard');
    if (!stage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    // A stage with a second card has 60 ORC rows, every other one 30.
    const rowCount = stage.usesSecondCard ? ORC_ROWS_PER_CARD * 2 : ORC_ROWS_PER_CARD;
    const rowParam = request.nextUrl.searchParams.get('row');
    const rowNumber = rowParam && /^\d{1,3}$/.test(rowParam) ? Number(rowParam) : NaN;
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > rowCount) {
      return NextResponse.json(
        { error: `Row must be a number from 1 to ${rowCount}` },
        { status: 400 }
      );
    }

    const rallyId = String(stage.rallyId);
    const [rally, participants, sheets] = await Promise.all([
      Rally.findById(rallyId).select('name'),
      Participant.find({ rallyId }).sort({ eq: 1 }),
      AnswerSheet.find({ stageId }).select('eq answers'),
    ]);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    // A key row the stage never got is a row with no letters: it costs nothing,
    // exactly as on the card.
    const storedKeyRow = (stage.scoreKey || []).find(
      (row: any) => row.rowNumber === rowNumber
    );
    const keyRow: ScoreKeyRow = {
      rowNumber,
      answers: (storedKeyRow?.answers || []).filter(Boolean),
      alternativeAnswers: (storedKeyRow?.alternativeAnswers || [])
        .map((variant: string[]) => (variant || []).filter(Boolean))
        .filter((variant: string[]) => variant.length > 0),
      falseAnswers: (storedKeyRow?.falseAnswers || [])
        .filter((entry: any) => entry?.value)
        .map((entry: any) => ({ column: entry.column, value: entry.value })),
      maxPenalty: storedKeyRow?.maxPenalty || 0,
      orderMatters: Boolean(storedKeyRow?.orderMatters),
    };

    const sheetByEq = new Map<number, any>(sheets.map((sheet: any) => [sheet.eq, sheet]));
    const participantByEq = new Map<number, any>(
      participants.map((participant: any) => [participant.eq, participant])
    );

    // Every crew of the rally: the entry list, plus an EQ that only exists as a
    // sheet of this stage — its card is still scored.
    const eqs = new Set<number>(participantByEq.keys());
    for (const sheet of sheets) eqs.add(sheet.eq);
    const orderedEqs = Array.from(eqs).sort((a, b) => a - b);

    const entries: RowReportEntry[] = orderedEqs.map((eq) => {
      const sheet = sheetByEq.get(eq);
      const participant = participantByEq.get(eq);
      const row = (sheet?.answers || []).find((entry: any) => entry.rowNumber === rowNumber);
      const selectedAnswers: string[] = [...(row?.selectedAnswers || [])];
      const answerRow = { rowNumber, selectedAnswers };

      let status: RowReportEntry['status'];
      if (!sheet) status = 'noSheet';
      else if ((sheet.answers || []).length === 0) status = 'untyped';
      else if (selectedAnswers.some(Boolean)) status = 'answered';
      else status = 'blank';

      return {
        eq,
        classification: participant?.classification || '',
        driverName: participant?.driverName || '',
        navigatorName: participant?.navigatorName || '',
        status,
        sheetId: sheet ? String(sheet._id) : null,
        selectedAnswers,
        penalty: calculateRowPenalty(keyRow, answerRow),
        orderError: hasOrderError(keyRow, answerRow),
      };
    });

    // Only a typed card says what a crew answered. A sheet nobody has typed and
    // a stage a crew has no sheet for are charged the blank row too, but
    // counting them here would read as crews who left the row empty.
    const typed = entries.filter(
      (entry) => entry.status === 'answered' || entry.status === 'blank'
    );

    const groups = new Map<string, RowReportAnswerGroup>();
    for (const entry of typed) {
      const letters = entry.selectedAnswers.filter(Boolean);
      const groupKey = letters.join(' ');
      const group = groups.get(groupKey);
      if (group) {
        group.count += 1;
        group.eqs.push(entry.eq);
      } else {
        groups.set(groupKey, {
          letters,
          count: 1,
          penalty: entry.penalty,
          orderError: entry.orderError,
          eqs: [entry.eq],
        });
      }
    }
    const answers = Array.from(groups.values()).sort(
      (a, b) =>
        b.count - a.count ||
        a.penalty - b.penalty ||
        a.letters.join('').localeCompare(b.letters.join(''))
    );

    const withPenalty = typed.filter((entry) => entry.penalty > 0).length;

    const payload: RowReport = {
      rally: { _id: String(rally._id), name: rally.name },
      stage: { _id: String(stage._id), name: stage.name },
      rowNumber,
      rowCount,
      key: {
        answers: keyRow.answers,
        alternativeAnswers: keyRow.alternativeAnswers || [],
        falseAnswers: (keyRow.falseAnswers || []).map((entry) => entry.value),
        maxPenalty: keyRow.maxPenalty || 0,
        orderMatters: Boolean(keyRow.orderMatters),
      },
      summary: {
        typedCards: typed.length,
        withPenalty,
        withoutPenalty: typed.length - withPenalty,
        blank: typed.filter((entry) => entry.status === 'blank').length,
        totalPenalty: typed.reduce((sum, entry) => sum + entry.penalty, 0),
        untyped: entries.filter((entry) => entry.status === 'untyped').length,
        noSheet: entries.filter((entry) => entry.status === 'noSheet').length,
      },
      answers,
      entries,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Failed to build row report:', error);
    return NextResponse.json({ error: 'Failed to build row report' }, { status: 500 });
  }
}
