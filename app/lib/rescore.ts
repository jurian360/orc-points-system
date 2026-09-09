import 'server-only';

// Re-scoring of stored answer sheets.
//
// Both totals on a sheet are denormalised: `totalPenalty` is what the standings
// read, so it has to be recomputed whenever anything it depends on changes. For
// the ORC's and the merk part that is only the sheet and its stage's keys, but
// the time part of a rally is a *chain*: the delta a participant carries out of
// one stage is the starting point of the next, and whether a stage is the last
// one — which decides whether a blown finish window is a penalty or a
// disqualification — changes as soon as a stage is added or deleted.
//
// So a write never rescores a single sheet: it rescores every sheet of the
// participants it can affect, in stage order, in one bulkWrite.

import mongoose from 'mongoose';

import { AnswerSheet } from '../models';
import { calculateMerkPenalty, calculateTotalPenalty, scoreAnswerRows } from './scoring';
import { loadRunningOrder } from './rallyOrder';
import { scoreRallyTimes, type RallyStageTimeInput, type TimeEntryRow } from './timeScoring';

interface RescoreOptions {
  // Limit the work to these participants. Omit to rescore the whole rally,
  // which is what a change to a stage requires.
  eqs?: number[];
}

// Recompute `totalPenalty` (ORC's + time + merk), the per-row time and merk
// cells and the disqualification flag for a rally, or for just some of its
// participants.
export async function rescoreRally(rallyId: unknown, options: RescoreOptions = {}) {
  // The running order — the routes in their order, and inside a route the
  // creation order of its stages. It is what the time chain is: which start is
  // free, where the delta is neutralised, and which finish disqualifies
  // (app/lib/rallyOrder.ts).
  const { stages } = await loadRunningOrder(rallyId);

  const query: Record<string, unknown> = { rallyId };
  if (options.eqs) {
    // An empty list means there is nothing to do rather than "everything".
    if (options.eqs.length === 0) return;
    // `sanitizeFilter` (app/lib/mongodb.ts) wraps any operator that reaches a
    // filter in `$eq`, which turns this into a cast error. `trusted` is the
    // documented opt-out and is safe here precisely because the backstop is not
    // what makes it safe: these are integers, checked by `Number.isInteger`
    // below and originally by `parseEq`, never a value off the wire.
    query.eq = mongoose.trusted({ $in: options.eqs });
  }

  const sheets = await AnswerSheet.find(query);
  if (sheets.length === 0) return;

  const stageById = new Map(stages.map((stage: any) => [String(stage._id), stage]));
  const stageInputs: RallyStageTimeInput[] = stages.map((stage: any) => ({
    stageId: String(stage._id),
    routeId: stage.routeId ? String(stage.routeId) : null,
    timeScoreKey: stage.timeScoreKey,
    timeConfig: stage.timeConfig,
  }));

  // Group by participant: the time chain runs per participant across stages.
  const byParticipant = new Map<number, any[]>();
  for (const sheet of sheets) {
    const group = byParticipant.get(sheet.eq) || [];
    group.push(sheet);
    byParticipant.set(sheet.eq, group);
  }

  const operations: any[] = [];

  for (const [eq, participantSheets] of byParticipant) {
    const entriesByStage = new Map<string, TimeEntryRow[]>(
      participantSheets.map((sheet) => [
        String(sheet.stageId),
        (sheet.timePenalties || []) as TimeEntryRow[],
      ])
    );

    const timeResults = scoreRallyTimes(stageInputs, eq, entriesByStage);

    for (const sheet of participantSheets) {
      const stage = stageById.get(String(sheet.stageId));
      const timeResult = timeResults.get(String(sheet.stageId));

      const orcPenalty = stage ? calculateTotalPenalty(stage.scoreKey, sheet.answers) : 0;
      const timePenalty = timeResult ? timeResult.totalPenalty : 0;
      // The merk column is scored against the stage's merk key, vertically: an
      // untyped column costs every letter of the key, exactly like a blank card.
      const merkResult = calculateMerkPenalty(stage?.merkScoreKey, sheet.merkScores);

      operations.push({
        updateOne: {
          filter: { _id: sheet._id },
          update: {
            $set: {
              // The officials' letters are kept; the strafpunten of a row are
              // derived from the stage key, exactly as the time and merk rows
              // are — nothing on a sheet claims a penalty of its own.
              answers: scoreAnswerRows(stage?.scoreKey, sheet.answers),
              // The stored rows keep the officials' WPT and add the derived
              // ideal time, +/- and penalty of every row.
              timePenalties: timeResult
                ? timeResult.rows.map((row) => ({
                    rowNumber: row.rowNumber,
                    ipt: row.ipt,
                    wpt: row.wpt,
                    plusMinus: row.plusMinus,
                    strafp: row.strafp,
                    outOfWindow: row.outOfWindow,
                    missing: row.missing,
                    free: row.free,
                  }))
                : sheet.timePenalties,
              timePenalty,
              // The officials' letters are kept; only the derived penalty of a
              // row — the 30 points it made a double — is (re)written.
              merkScores: merkResult.rows.map((row) => ({
                rowNumber: row.rowNumber,
                merk: row.merk,
                strafp: row.strafp,
              })),
              merkPenalty: merkResult.totalPenalty,
              disqualified: timeResult ? timeResult.disqualified : false,
              startDelta: timeResult ? timeResult.startDelta : 0,
              endDelta: timeResult ? timeResult.endDelta : 0,
              totalPenalty: orcPenalty + timePenalty + merkResult.totalPenalty,
            },
          },
        },
      });
    }
  }

  if (operations.length > 0) {
    await AnswerSheet.bulkWrite(operations);
  }
}

// Convenience wrapper for the answer-sheet routes: a sheet write only moves the
// chain of the participants it touched (both the old and the new eq when a sheet
// is renumbered). Non-integers are dropped rather than passed to the query.
export async function rescoreParticipants(rallyId: unknown, eqs: number[]) {
  const unique = Array.from(new Set(eqs.filter((eq) => Number.isInteger(eq))));
  await rescoreRally(rallyId, { eqs: unique });
}
