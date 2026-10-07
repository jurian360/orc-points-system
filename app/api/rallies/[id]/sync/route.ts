import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/mongodb';
import { readBody, requireSession } from '../../../../lib/api-guard';
import { rescoreParticipants } from '../../../../lib/rescore';
import { typedSheetContent } from '../../../../lib/sheetContent';
import {
  DIVERSEN_COUNT_ERROR,
  MAX_SYNC_SHEETS,
  MERK_ROWS_PER_CARD,
  ORC_ROWS_PER_CARD,
  parseAnswerRows,
  parseDiversenCount,
  parseEq,
  parseMerkScores,
  parseObjectId,
  parseTimePenalties,
} from '../../../../lib/validation';
import { AnswerSheet, Participant, Rally, Stage } from '../../../../models';

type SyncStatus = 'saved' | 'conflict' | 'error';

interface SyncResult {
  stageId: string;
  eq: number;
  status: SyncStatus;
  // On a conflict: the server's sheet, so the official can compare the two
  // cards. `null` when the server has no sheet any more (it was deleted).
  sheet?: unknown;
  error?: string;
}

// POST /api/rallies/[id]/sync — the cards the offline workspace (app/offline)
// typed or corrected without a connection, uploaded once it has one again. See
// "Offline mode" in CLAUDE.md.
//
// Body: `{ sheets: [{ stageId, eq, baseRevision, deleted?, answers,
// timePenalties, merkScores, diversenCount }] }`, at most MAX_SYNC_SHEETS.
// Each item is the *whole* card as the workspace holds it — the typed fields
// only — not an edit to replay, so sending it twice is the same as sending it
// once. `baseRevision` is the sheet's `revision` when the workspace downloaded
// it, or null for a card it created.
//
// Per card, the rule is the server's copy decides:
//   * no sheet on the server and `baseRevision` null — the card is created;
//   * the server's `revision` is still `baseRevision` — nobody else changed the
//     card meanwhile, so the workspace's version replaces it;
//   * the server already holds exactly what was sent — a request applied before
//     whose answer never arrived: saved, nothing written;
//   * anything else is a **conflict**: somebody else (an official online, or the
//     crew through the Android app) changed the card meanwhile. Nothing is
//     written and the server's sheet comes back, so the official chooses.
//
// A sheet is the one thing a data-entry account may write, so the guard is
// `requireSession()` — the same as POST/PUT /api/answersheets, whose checks
// this repeats per card: the stage belongs to this rally, the crew is on its
// entry list, and only typed fields are taken (the scoring is redone here by
// `rescoreParticipants`, once for every crew the upload touched).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const { id } = await params;
  const rallyId = parseObjectId(id);
  if (!rallyId) {
    return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
  }

  if (!Array.isArray(body.sheets) || body.sheets.length === 0) {
    return NextResponse.json({ error: 'No sheets to upload' }, { status: 400 });
  }
  if (body.sheets.length > MAX_SYNC_SHEETS) {
    return NextResponse.json(
      { error: `At most ${MAX_SYNC_SHEETS} sheets per upload` },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const rally = await Rally.findById(rallyId).select('_id').lean();
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const [stages, participants] = await Promise.all([
      Stage.find({ rallyId }).select('usesSecondCard').lean(),
      Participant.find({ rallyId }).select('eq').lean(),
    ]);
    const stageById = new Map(stages.map((stage: any) => [String(stage._id), stage]));
    const enteredEqs = new Set(participants.map((participant: any) => participant.eq));

    const results: SyncResult[] = [];
    const touchedEqs: number[] = [];

    for (const raw of body.sheets as unknown[]) {
      const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const stageId = parseObjectId(item.stageId);
      const eq = parseEq(item.eq);
      const label = { stageId: stageId || String(item.stageId ?? ''), eq: eq ?? 0 };

      const fail = (error: string) => results.push({ ...label, status: 'error', error });

      if (!stageId || eq === null) {
        fail('Invalid stage or EQ');
        continue;
      }

      const stage = stageById.get(stageId);
      if (!stage) {
        fail('This stage no longer exists');
        continue;
      }

      const baseRevision = item.baseRevision;
      if (
        baseRevision !== null &&
        !(typeof baseRevision === 'number' && Number.isInteger(baseRevision) && baseRevision >= 0)
      ) {
        fail('Invalid revision');
        continue;
      }

      // `eq` and `stageId` went through parseEq / parseObjectId above, so this
      // filter holds no value off the wire.
      const existing: any = await AnswerSheet.findOne({ stageId, eq }).lean();
      const serverRevision = existing ? existing.revision ?? 0 : null;

      if (item.deleted === true) {
        if (!existing) {
          results.push({ ...label, status: 'saved' });
          continue;
        }
        if (serverRevision !== baseRevision) {
          results.push({ ...label, status: 'conflict', sheet: existing });
          continue;
        }
        // Matched on the revision too, so a change that landed between the read
        // above and this delete is not thrown away with it. `revision: null`
        // matches a sheet from before the field existed.
        const deleted = await AnswerSheet.deleteOne({
          _id: existing._id,
          revision: existing.revision ?? null,
        });
        if (deleted.deletedCount === 0) {
          const current = await AnswerSheet.findById(existing._id).lean();
          results.push({ ...label, status: 'conflict', sheet: current });
          continue;
        }
        touchedEqs.push(eq);
        results.push({ ...label, status: 'saved' });
        continue;
      }

      // A crew with no Participant record cannot have a card typed, exactly as
      // POST /api/answersheets refuses one.
      if (!enteredEqs.has(eq)) {
        fail(`EQ ${eq} is not on the entry list`);
        continue;
      }

      const diversenCount = parseDiversenCount(item.diversenCount);
      if (diversenCount === null) {
        fail(DIVERSEN_COUNT_ERROR);
        continue;
      }

      // Caps per card, as the answer-sheet routes resolve them.
      const orcCap = stage.usesSecondCard ? ORC_ROWS_PER_CARD * 2 : ORC_ROWS_PER_CARD;
      const merkCap = stage.usesSecondCard ? MERK_ROWS_PER_CARD * 2 : MERK_ROWS_PER_CARD;
      const typed = {
        answers: parseAnswerRows(item.answers, orcCap),
        timePenalties: parseTimePenalties(item.timePenalties),
        merkScores: parseMerkScores(item.merkScores, merkCap),
        diversenCount,
      };

      // Already there: a request applied before whose answer was lost.
      if (existing && typedSheetContent(existing) === typedSheetContent(typed)) {
        results.push({ ...label, status: 'saved' });
        continue;
      }

      if (!existing) {
        if (baseRevision !== null) {
          // The workspace had this card from the server, and it is gone: an
          // official deleted it meanwhile. Not the workspace's call to undo.
          results.push({ ...label, status: 'conflict', sheet: null });
          continue;
        }

        try {
          // The totals are left to the re-score below, as the time import does.
          await AnswerSheet.create({ eq, rallyId, stageId, ...typed });
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 11000) {
            // Created by somebody else between the read and this insert.
            const current = await AnswerSheet.findOne({ stageId, eq }).lean();
            results.push({ ...label, status: 'conflict', sheet: current });
            continue;
          }
          throw error;
        }
        touchedEqs.push(eq);
        results.push({ ...label, status: 'saved' });
        continue;
      }

      if (serverRevision !== baseRevision) {
        results.push({ ...label, status: 'conflict', sheet: existing });
        continue;
      }

      const updated = await AnswerSheet.updateOne(
        { _id: existing._id, revision: existing.revision ?? null },
        { $set: typed, $inc: { revision: 1 } }
      );
      if (updated.matchedCount === 0) {
        const current = await AnswerSheet.findById(existing._id).lean();
        results.push({ ...label, status: 'conflict', sheet: current });
        continue;
      }
      touchedEqs.push(eq);
      results.push({ ...label, status: 'saved' });
    }

    // Every card written moves its crew's time chain, so their whole rally is
    // re-scored — once, for every crew of the upload.
    await rescoreParticipants(rallyId, touchedEqs);

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Failed to upload offline sheets:', error);
    return NextResponse.json({ error: 'Failed to upload the sheets' }, { status: 500 });
  }
}
