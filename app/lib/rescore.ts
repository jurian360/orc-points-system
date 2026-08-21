import 'server-only';

// Re-scoring of stored answer sheets.
//
// Both totals on a sheet are denormalised: `totalPenalty` is what the standings
// read, so it has to be recomputed whenever anything it depends on changes. For
// the ORC's part that is only the sheet and its stage's answer key, but the time
// part of a rally is a *chain*: the delta a participant carries out of one stage
// is the starting point of the next, and whether a stage is the last one — which
// decides whether a blown finish window is a penalty or a disqualification —
// changes as soon as a stage is added or deleted.
//
// So a write never rescores a single sheet: it rescores every sheet of the
// participants it can affect, in stage order, in one bulkWrite.

import { AnswerSheet, Stage } from '../models';
import { calculateTotalPenalty } from './scoring';
import { scoreRallyTimes, type RallyStageTimeInput, type TimeEntryRow } from './timeScoring';

// The running order of a rally is the order its stages were created in — the
// same order the stage list and the participant view show.
async function loadStagesInOrder(rallyId: unknown) {
  return Stage.find({ rallyId }).sort({ createdAt: 1, _id: 1 });
}

interface RescoreOptions {
  // Limit the work to these participants. Omit to rescore the whole rally,
  // which is what a change to a stage requires.
  eqs?: number[];
}

// Recompute `totalPenalty` (ORC's + time), the per-row time cells and the
// disqualification flag for a rally, or for just some of its participants.
export async function rescoreRally(rallyId: unknown, options: RescoreOptions = {}) {
  const stages = await loadStagesInOrder(rallyId);

  const query: Record<string, unknown> = { rallyId };
  if (options.eqs) {
    // Callers pass validated participant numbers (parseEq); an empty list means
    // there is nothing to do rather than "everything".
    if (options.eqs.length === 0) return;
    query.eq = { $in: options.eqs };
  }

  const sheets = await AnswerSheet.find(query);
  if (sheets.length === 0) return;

  const stageById = new Map(stages.map((stage: any) => [String(stage._id), stage]));
  const stageInputs: RallyStageTimeInput[] = stages.map((stage: any) => ({
    stageId: String(stage._id),
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

      operations.push({
        updateOne: {
          filter: { _id: sheet._id },
          update: {
            $set: {
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
                  }))
                : sheet.timePenalties,
              timePenalty,
              disqualified: timeResult ? timeResult.disqualified : false,
              startDelta: timeResult ? timeResult.startDelta : 0,
              endDelta: timeResult ? timeResult.endDelta : 0,
              totalPenalty: orcPenalty + timePenalty,
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
// is renumbered).
export async function rescoreParticipants(rallyId: unknown, eqs: number[]) {
  const unique = Array.from(new Set(eqs.filter((eq) => Number.isInteger(eq))));
  await rescoreRally(rallyId, { eqs: unique });
}
