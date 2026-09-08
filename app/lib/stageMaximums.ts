// The most one stage of a rally can cost a participant.
//
// A stage is scored in three parts — the ORC's letters, the time column and the
// merk column — and each part has a maximum of its own: `maxOrcPenalty` and
// `maxMerkPenalty` (app/lib/scoring.ts) and `maxStageTimePenalty`
// (app/lib/timeScoring.ts). This module puts the three together, because two
// places need the whole card's maximum rather than one part of it:
//
//   * the stage form and the stage key card, which show officials what the key
//     they are typing can cost at worst;
//   * a **stage a crew handed no card in for**. A missing sheet is not a stage a
//     crew rode for free: they were not scored on it, so they are charged what
//     the stage can cost — the maximum of every part. Otherwise a crew who hands
//     in one card of three leads the standings on a third of the points, and
//     handing in a card would be worse than handing in nothing.
//
// It is the one home of that rule: the standings route
// (app/api/rallies/[id]/standings) adds these numbers for the stages a crew has
// no sheet for, and the participant view shows the same ones on the stage it
// lists as missing, so the screen and the standings cannot disagree.
//
// Nothing here is stored on a sheet: a sheet that does not exist has nothing to
// store the points on, so they are added where the rally is added up.

import { maxMerkPenalty, maxOrcPenalty } from './scoring';
import type { MerkKeyRow, ScoreKeyRow } from './scoring';
import { maxStageTimePenalty } from './timeScoring';
import type { StageTimeConfig, TimeKeyRow } from './timeScoring';

// A stage as this module reads it: its three keys and its time settings. Both
// the API (a Mongoose document) and the browser (the JSON of `/api/stages`)
// carry these fields.
export interface StageKeys {
  scoreKey?: ScoreKeyRow[] | null;
  timeScoreKey?: TimeKeyRow[] | null;
  merkScoreKey?: MerkKeyRow[] | null;
  timeConfig?: Partial<StageTimeConfig> | null;
}

// The three parts of a stage penalty and their sum — the same shape a standings
// entry carries per stage.
export interface StagePenaltyParts {
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  totalPenalty: number;
}

// The maximum of every part of one stage. `isFinalStage` matters for the time
// part only: the finish of a stage that is followed by another one also loses
// the break after it.
export function stageMaxPenalties(
  stage: StageKeys | null | undefined,
  isFinalStage: boolean
): StagePenaltyParts {
  const orcPenalty = maxOrcPenalty(stage?.scoreKey || undefined);
  const timePenalty = maxStageTimePenalty(
    stage?.timeScoreKey,
    stage?.timeConfig,
    isFinalStage
  );
  const merkPenalty = maxMerkPenalty(stage?.merkScoreKey || undefined);

  return {
    orcPenalty,
    timePenalty,
    merkPenalty,
    totalPenalty: orcPenalty + timePenalty + merkPenalty,
  };
}
