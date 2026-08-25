import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../../lib/mongodb';
import { AnswerSheet, Participant, Stage } from '../../../../../models';
import { readBody, requireRallyAdmin } from '../../../../../lib/api-guard';
import { rescoreParticipants } from '../../../../../lib/rescore';
import {
  MAX_IMPORT_TIMES,
  parseEq,
  parseTimeRowNumber,
  parseWpt,
} from '../../../../../lib/validation';
import { TIME_ROWS, timeRowLabel } from '../../../../../lib/timeScoring';
import mongoose from 'mongoose';

// POST /api/stages/[id]/times/import
//
// The times of one control of one stage, as handed in by the control itself.
// The file is read in the browser (app/lib/spreadsheet.ts, app/lib/timeImport.ts)
// and only `{ eq, wpt }` per participant arrives here, so this stays an ordinary
// JSON route behind the 256 KB object-only body guard — no file upload path and
// no parser on the server.
//
// What it writes is exactly what an official types on the card: the WPT of one
// row. Everything derived from it — the participant's ideal time, the +/-, the
// penalty of the row and the delta the rest of the rally is measured against —
// is recomputed by `rescoreParticipants` afterwards, because a time never
// affects one sheet only.
//
// Two rules the wizard shows before it sends:
//
//   * a time can only be imported for a crew that is in the entry list of the
//     rally. An EQ without a participant record rejects the whole import: it
//     means the file and the rally disagree about who is riding, and a control
//     export is not the place to invent a participant.
//   * a participant who has no sheet for this stage yet gets one when
//     `createMissingSheets` is set, holding only this time. Without it those
//     lines are reported as skipped instead.
//
// Validation is all-or-nothing, like the entry-list import: one unusable line
// rejects the request, because a half-imported control is worse than none.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const rowNumber = parseTimeRowNumber(parsed.body.rowNumber);
  if (rowNumber === null) {
    return NextResponse.json(
      { error: `rowNumber must be an integer between 1 and ${TIME_ROWS}` },
      { status: 400 }
    );
  }

  const createMissingSheets = parsed.body.createMissingSheets === true;

  const lines = parsed.body.times;
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json(
      { error: 'The import is empty — there are no times to save' },
      { status: 400 }
    );
  }

  // A control times each participant once, and a rally has 100 of them.
  if (lines.length > MAX_IMPORT_TIMES) {
    return NextResponse.json(
      { error: `An import holds at most ${MAX_IMPORT_TIMES} times` },
      { status: 400 }
    );
  }

  // Every value is proven to be a scalar of the right shape before it reaches a
  // query or the database — the client-side preview is a convenience, not a
  // guard.
  const times: { eq: number; wpt: string }[] = [];
  const seen = new Set<number>();

  for (const [index, line] of lines.entries()) {
    const raw = (line ?? {}) as Record<string, unknown>;
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

    const wpt = parseWpt(raw.wpt);
    if (wpt === null) {
      return NextResponse.json(
        { error: `Row ${position}: the time must be a clock time such as 19:27` },
        { status: 400 }
      );
    }

    times.push({ eq, wpt });
  }

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 });
    }

    await dbConnect();

    const stage = await Stage.findById(id);
    if (!stage) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    const eqs = times.map((time) => time.eq);
    // `mongoose.trusted` is the documented opt-out of the `sanitizeFilter`
    // backstop (app/lib/mongodb.ts), and it is safe here for the same reason it
    // is in app/lib/rescore.ts: these are integers `parseEq` has proven, never a
    // value off the wire. A fresh one per query, so no two queries share the
    // object they are cast from.
    const eqFilter = () => mongoose.trusted({ $in: eqs });

    // The rally has to know these crews first: the entry list is what says who
    // is riding, and a control export naming somebody else is a mismatch the
    // officials have to resolve, not something to import halfway.
    const participants = await Participant.find({ rallyId: stage.rallyId, eq: eqFilter() })
      .select('eq')
      .lean();
    const known = new Set(participants.map((participant: any) => participant.eq as number));
    const unknown = eqs.filter((eq) => !known.has(eq));

    if (unknown.length > 0) {
      const listed = unknown.slice(0, 10).join(', ');
      return NextResponse.json(
        {
          error:
            `These EQ numbers are not participants of this rally: ${listed}` +
            `${unknown.length > 10 ? `, and ${unknown.length - 10} more` : ''}. ` +
            'Import the entry list first.',
          unknownEqs: unknown,
        },
        { status: 400 }
      );
    }

    const sheets = await AnswerSheet.find({ stageId: id, eq: eqFilter() });
    const sheetByEq = new Map<number, any>(sheets.map((sheet: any) => [sheet.eq, sheet]));

    // The 10 time rows of a sheet, with this import's time on the chosen row and
    // every other row's WPT kept. `ipt`, `plusMinus` and `strafp` are left empty:
    // they are derived server-side, and the re-score below fills them in.
    const timeRowsWith = (existing: { rowNumber: number; wpt?: string }[], wpt: string) => {
      const byRow = new Map<number, string>();
      for (const row of existing || []) {
        if (row.wpt) byRow.set(row.rowNumber, row.wpt);
      }
      byRow.set(rowNumber, wpt);

      return Array.from({ length: TIME_ROWS }, (unused, index) => ({
        rowNumber: index + 1,
        ipt: '',
        wpt: byRow.get(index + 1) || '',
        plusMinus: '',
        strafp: 0,
        outOfWindow: false,
        missing: false,
      }));
    };

    const now = new Date();
    // Typed loosely, as in app/lib/rescore.ts: a mixed insert/update bulkWrite.
    const operations: any[] = [];
    let updated = 0;
    let created = 0;
    const skipped: number[] = [];

    for (const { eq, wpt } of times) {
      const sheet = sheetByEq.get(eq);

      if (sheet) {
        updated++;
        operations.push({
          updateOne: {
            filter: { _id: sheet._id },
            update: { $set: { timePenalties: timeRowsWith(sheet.timePenalties, wpt) } },
          },
        });
        continue;
      }

      if (!createMissingSheets) {
        skipped.push(eq);
        continue;
      }

      // A sheet that only holds a time: no ORC's and no merk letters have been
      // typed yet, so the card scores as an empty one — every letter of both
      // keys missing — until an official types it (see app/lib/scoring.ts).
      created++;
      operations.push({
        insertOne: {
          document: {
            eq,
            rallyId: stage.rallyId,
            stageId: id,
            answers: [],
            timePenalties: timeRowsWith([], wpt),
            merkScores: [],
            // rescoreParticipants below fills these in from the stage's keys.
            totalPenalty: 0,
            timePenalty: 0,
            merkPenalty: 0,
            disqualified: false,
            startDelta: 0,
            endDelta: 0,
            submittedAt: now,
          },
        },
      });
    }

    let writeError: unknown = null;

    if (operations.length > 0) {
      try {
        await AnswerSheet.bulkWrite(operations);
      } catch (error) {
        // A bulkWrite stops at the first failing operation, so the ones before
        // it did land. The re-score below still has to run over them, or their
        // stored totals stay behind — the failure is reported afterwards.
        writeError = error;
      }

      // A WPT moves the delta this participant carries into every later stage,
      // so their whole rally is re-scored — never just this sheet.
      await rescoreParticipants(stage.rallyId, times.map((time) => time.eq));
    }

    if (writeError) throw writeError;

    return NextResponse.json({
      message: `Times imported into ${timeRowLabel(rowNumber)}`,
      rowNumber,
      total: updated + created,
      updated,
      created,
      skipped: skipped.length,
      skippedEqs: skipped,
    });
  } catch (error) {
    // The unique {stageId, eq} index is the authoritative guard: a sheet created
    // while this import was running turns the insert into a duplicate key.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        {
          error:
            'A sheet for one of these participants was created while the import was running, ' +
            'so it stopped halfway. Everything it did write has been scored — run it again to ' +
            'import the rest.',
        },
        { status: 409 }
      );
    }

    console.error('Failed to import times:', error);
    return NextResponse.json({ error: 'Failed to import times' }, { status: 500 });
  }
}
