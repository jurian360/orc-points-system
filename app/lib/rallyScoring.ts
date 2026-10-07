// Scoring of a rally's answer sheets, pure and shared client + server.
//
// This is the computation `app/lib/rescore.ts` stores: the server runs it over
// the sheets it read and writes the result in one bulkWrite, and the offline
// workspace (app/offline) runs it over the sheets held in the browser. One
// function, so a card typed offline is scored exactly as it will be once it is
// uploaded — the server re-scores it anyway, and the two must not disagree.
//
// The time part of a rally is a chain: the delta a participant carries out of
// one stage is the starting point of the next, so a sheet is never scored on
// its own — every sheet of a participant is scored together, in running order.

import { calculateMerkPenalty, calculateTotalPenalty, scoreAnswerRows } from './scoring';
import { scoreRallyTimes, type RallyStageTimeInput, type TimeEntryRow } from './timeScoring';

// The fields of a stage the scoring reads. `stages` must already be in running
// order (app/lib/routes.ts `orderStagesByRoute`).
export interface ScoredStage {
  _id: unknown;
  routeId?: unknown;
  scoreKey?: any[];
  timeScoreKey?: any[];
  merkScoreKey?: any[];
  timeConfig?: any;
}

// The fields of a sheet the scoring reads: what an official typed.
export interface ScorableSheet {
  eq: number;
  stageId: unknown;
  answers?: any[];
  timePenalties?: any[];
  merkScores?: any[];
  diversenCount?: number;
}

// Everything derived on a sheet: what `rescore.ts` writes with `$set`.
export interface SheetScore {
  answers: any[];
  timePenalties: any[];
  timePenalty: number;
  merkScores: { rowNumber: number; merk: string; strafp: number }[];
  merkPenalty: number;
  disqualified: boolean;
  startDelta: number;
  endDelta: number;
  totalPenalty: number;
}

// Score every sheet given, grouped per participant. Returns the derived fields
// in the order of `sheets`.
export function scoreRallySheets<T extends ScorableSheet>(
  stages: readonly ScoredStage[],
  sheets: readonly T[]
): { sheet: T; score: SheetScore }[] {
  const stageById = new Map(stages.map((stage) => [String(stage._id), stage]));
  const stageInputs: RallyStageTimeInput[] = stages.map((stage) => ({
    stageId: String(stage._id),
    routeId: stage.routeId ? String(stage.routeId) : null,
    timeScoreKey: stage.timeScoreKey as any,
    timeConfig: stage.timeConfig,
  }));

  // Group by participant: the time chain runs per participant across stages.
  const byParticipant = new Map<number, T[]>();
  for (const sheet of sheets) {
    const group = byParticipant.get(sheet.eq) || [];
    group.push(sheet);
    byParticipant.set(sheet.eq, group);
  }

  const scores = new Map<T, SheetScore>();

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

      const orcPenalty = stage ? calculateTotalPenalty(stage.scoreKey as any, sheet.answers as any) : 0;
      const timePenalty = timeResult ? timeResult.totalPenalty : 0;
      // The merk column is scored against the stage's merk key, vertically: an
      // untyped column costs every letter of the key, exactly like a blank card.
      // The Diversen fine on row 6 is added on top of it.
      const merkResult = calculateMerkPenalty(
        stage?.merkScoreKey as any,
        sheet.merkScores as any,
        sheet.diversenCount
      );

      scores.set(sheet, {
        // The officials' letters are kept; the strafpunten of a row are
        // derived from the stage key, exactly as the time and merk rows
        // are — nothing on a sheet claims a penalty of its own.
        answers: scoreAnswerRows(stage?.scoreKey as any, sheet.answers as any),
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
          : sheet.timePenalties || [],
        timePenalty,
        // The officials' letters are kept; only the derived penalty of a
        // row — the 30 points it made a double — is (re)written. The rows
        // are the letter rows only, so a letter left on the Diversen row
        // from before it was one is dropped here.
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
      });
    }
  }

  return sheets.map((sheet) => ({ sheet, score: scores.get(sheet)! }));
}
