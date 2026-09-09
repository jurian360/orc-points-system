// What a stage a crew handed no card in for costs them.
//
// **A missing sheet is scored as a blank card**: the same numbers the crew would
// have got by handing in the card with nothing written on it. Not being scored
// on a stage is not riding it for free — a crew who hands in one card of three
// would otherwise lead the standings on a third of the points.
//
// It is scored by the same three functions a real sheet is, given nothing to
// score:
//
//   * the ORC's — `calculateTotalPenalty(scoreKey, [])`: the key decides which
//     rows are scored, so every letter of the key counts as missing;
//   * the time column — `scoreStageTimes` with no entries: every control the
//     stage uses is one the participant missed, which costs a GTC its flat
//     maximum and the finish the VTC's maximum plus the break after the
//     stage, unless the stage ends its route. The start costs nothing (it has no
//     window), and a missed control never moves the delta, so a stage nobody
//     typed does not disturb the chain of the stages around it;
//   * the merk column — `calculateMerkPenalty(merkScoreKey, [])`: an untyped
//     column, so every letter of the key counts as missing.
//
// That is the whole rule: `blankSheetPenalties` calls those three and adds them
// up. Nothing here re-implements a scoring rule, and a stage nobody has typed
// scores exactly like the blank card it stands for — the same total a time
// import's empty sheet gets, and the same one an official gets by opening that
// sheet in the form and saving it untouched.
//
// Nothing is stored: a sheet that does not exist has no rows to write points on,
// so the numbers are added where the rally is added up — the standings route
// (app/api/rallies/[id]/standings) — and `ParticipantAnswersView` shows the same
// ones on the stage it lists as missing, so the card page and the standings
// cannot disagree.

import { calculateMerkPenalty, calculateTotalPenalty } from './scoring';
import type { MerkKeyRow, ScoreKeyRow } from './scoring';
import type { LegPosition } from './routes';
import { scoreStageTimes } from './timeScoring';
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

// What one stage costs a crew who handed no card in for it: a blank card.
//
// Where the stage sits in the rally matters for the time part only, and it is
// the finish row that reads it: the finish of a stage another one follows *in
// the same route* also loses the break after it, and the finish of the last
// stage of the last route is where a participant with no time is out of the
// rally. It is taken as an object rather than as two booleans because two
// adjacent booleans is exactly how the wrong one gets passed.
//
// `startsRoute` is deliberately not among them: on a blank card the start row
// has no WPT, and a missing start is free whether it opens a leg or not. Nor is
// the participant number or the delta they carry in — every row of a blank card
// is a control they missed, and a missed control is a flat penalty that leaves
// the delta where it was. So a stage's blank card is still scored once and costs
// every crew the same.
export function blankSheetPenalties(
  stage: StageKeys | null | undefined,
  position: Pick<LegPosition, 'endsRoute' | 'endsRally'>
): StagePenaltyParts {
  const orcPenalty = calculateTotalPenalty(stage?.scoreKey || [], []);
  const timePenalty = scoreStageTimes({
    timeScoreKey: stage?.timeScoreKey,
    timeConfig: stage?.timeConfig,
    eq: 0,
    entries: [],
    endsRoute: position.endsRoute,
    endsRally: position.endsRally,
  }).totalPenalty;
  const merkPenalty = calculateMerkPenalty(stage?.merkScoreKey || undefined, []).totalPenalty;

  return {
    orcPenalty,
    timePenalty,
    merkPenalty,
    totalPenalty: orcPenalty + timePenalty + merkPenalty,
  };
}
