import type { StageTimeConfig, TimeRowKind } from '../lib/timeScoring';
import type { ClassificationValue } from '../lib/participants';
import type { StandingsStatus } from '../lib/standings';

// Rally types
export interface Rally {
  _id: string;
  name: string;
  // Short public identifier, handed to the Android app as its `rallycode` and
  // sent back with a card the participant finalises. Generated on first use, so
  // it is missing on a rally that has never issued a QR code.
  code?: string;
  createdAt: string;
}

// A sequential leg of a rally: every crew rides route 1, then route 2, and the
// time delta is neutralised at the boundary. Most rallies have none — a rally
// with no routes is one implicit leg (app/lib/routes.ts).
export interface Route {
  _id: string;
  rallyId: string;
  name: string;
  // Place in the rally: 1, 2, 3 … The stages inside a route keep their creation
  // order; the routes themselves are ordered by this.
  order: number;
  createdAt: string;
}

// Stage types (a stage holds the answer key for one leg of a rally)
export interface Stage {
  _id: string;
  rallyId: string;
  // The route this stage is ridden in. Absent on a rally with no routes, which
  // is most of them.
  routeId?: string | null;
  name: string;
  // Stable card number of this stage within its rally — what a submission from
  // the app is resolved by. Unlike the stage's place in the running order, it
  // does not move when another stage is deleted.
  cardId?: number;
  createdAt: string;
  scoreKey: ScoreKeyRow[];
  timeScoreKey?: TimeScoreKeyRow[];
  merkScoreKey?: MerkScoreKeyRow[];
  timeConfig?: StageTimeConfig;
  // Whether this stage's ORC rows run 1-60 and its merk rows 1-12 instead of
  // 1-30/1-6 — a crew ran out of rows mid-stage and switched to a second
  // paper card. The time module is unaffected either way.
  usesSecondCard?: boolean;
}

export interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
  // Further complete answers the row accepts, added by an appeal. The row costs
  // the least of its accepted answers — see app/lib/scoring.ts.
  alternativeAnswers?: string[][];
  falseAnswers?: { column: number; value: string }[];
  maxPenalty?: number;
  // The letters of this row have to be given in the order of the key.
  orderMatters?: boolean;
}

// Time key row of a stage. `ipt` is the ideal passage time of participant 0;
// every other participant's ideal time is that plus their eq in minutes.
export interface TimeScoreKeyRow {
  rowNumber: number;
  ipt: string;
  wpt: string;
  plusMinus: string;
  maxPenalty?: number;
}

// Merk key row of a stage: one correct letter and one letter the key rules out.
// The merk column is scored vertically — the column as a whole is compared with
// the key — so both letters are read as part of a column-wide set and
// `maxPenalty` is not a row cap; the row maximums are summed into one cap on the
// column.
export interface MerkScoreKeyRow {
  rowNumber: number;
  merk: string;
  falseMerk?: string;
  maxPenalty?: number;
}

// Participant of a rally: the crew riding under an EQ number. Optional — an EQ
// with answer sheets but no record is still scored, it just has no name.
export interface Participant {
  _id: string;
  rallyId: string;
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ParticipantFormData {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

// Answer sheet types (a participant's submission for one stage)
export interface AnswerSheet {
  _id: string;
  eq: number;
  rallyId: string;
  stageId: string;
  answers: AnswerSheetRow[];
  timePenalties?: TimePenaltyRow[];
  merkScores?: MerkScoreRow[];
  // The count on merk row 6, the Diversen row: 30 points each, part of
  // `merkPenalty` (see app/lib/scoring.ts).
  diversenCount?: number;
  totalPenalty: number;
  timePenalty?: number;
  merkPenalty?: number;
  disqualified?: boolean;
  startDelta?: number;
  endDelta?: number;
  submittedAt: string;
}

export interface AnswerSheetRow {
  rowNumber: number;
  selectedAnswers: string[];
  strafp?: number;
}

// Time row of a sheet. Officials type the `wpt`; the rest is computed from the
// stage's time key (see app/lib/timeScoring.ts).
export interface TimePenaltyRow {
  rowNumber: number;
  ipt: string;
  wpt: string;
  plusMinus: string;
  strafp: number;
  outOfWindow?: boolean;
  // The stage uses this control but the sheet has no WPT for it.
  missing?: boolean;
  // The start row of the first stage of a route: the leg begins here, so it is
  // shown but costs nothing and does not move the delta.
  free?: boolean;
}

// Merk row of a sheet. Officials type the letter the participant wrote; the
// `strafp` is computed from the stage's merk key (see app/lib/scoring.ts) and is
// the 30 points that letter cost as a double or as a false merk — a *missing*
// letter belongs to no row and is only in the sheet's `merkPenalty`.
export interface MerkScoreRow {
  rowNumber: number;
  merk: string;
  strafp: number;
}

// One stage of a rally as the standings name it: the running order, so a
// per-stage column can be headed with the stage it belongs to.
export interface StandingsStage {
  _id: string;
  name: string;
  // The route this stage is ridden in, so the results can group their per-stage
  // columns by leg. Null on a rally with no routes.
  routeId?: string | null;
}

// One route of a rally as the standings name it, in the order it is ridden.
// Empty on a rally with no routes — which is how a consumer tells a rally that
// has legs from one that does not.
export interface StandingsRoute {
  _id: string;
  name: string;
}

// What one participant scored on one stage — the same three parts as their
// rally total, taken from that one sheet. A stage a crew has **no** sheet for
// carries what a blank card costs on it (app/lib/missingSheets.ts) with
// `missingSheet` set: not being scored on a stage is not riding it for free.
export interface StandingsStageScore {
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  disqualified: boolean;
  // True when there is no card behind these numbers: the stage was scored as a
  // blank one.
  missingSheet: boolean;
}

// Standings entry for a rally (one row per participant)
export interface StandingsEntry {
  eq: number;
  // Copied onto the entry by the standings route from the participant record;
  // empty when nobody has recorded who this EQ is.
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  // The three parts of `totalPenalty`: the ORC's (letters), the time penalty and
  // the merk penalty (shown as "Diversen").
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  // The same three parts per stage, keyed by stage id, so the results can show
  // where in the rally a crew lost their points instead of only the sum. The
  // rally totals above are these added up; they are not recomputed from this.
  stagePenalties: Record<string, StandingsStageScore>;
  sheetsSubmitted: number;
  // The stages of the rally this crew has no sheet for. Each of them is scored
  // as a blank card, and is part of the totals above.
  missingSheets: number;
  // Set from the cards: the crew passed the finish of the last stage outside its
  // window, or had no finish time on it. It is one of the two ways to be a DNF —
  // read `status`, which also covers the crew who handed no last-stage card in
  // at all.
  disqualified: boolean;
  // Whether the crew finished, did not finish or did not start
  // (app/lib/standings.ts). Only a `finished` crew has a place; the other two
  // are ranked behind the field and print their status instead of a number.
  status: StandingsStatus;
  rank: number;
}

// Form submission types
export interface RallyFormData {
  name: string;
  // The rally's public code. Officials choose it when they create the rally;
  // left out of a PUT it keeps the code it has, because a rally with no code
  // cannot be scanned into the app at all.
  code?: string;
}

export interface StageFormData {
  name: string;
  scoreKey: ScoreKeyRow[];
  timeScoreKey?: TimeScoreKeyRow[];
  merkScoreKey?: MerkScoreKeyRow[];
  timeConfig?: StageTimeConfig;
}

export interface AnswerSheetFormData {
  eq: number;
  rallyId: string;
  stageId: string;
  answers: AnswerSheetRow[];
  timePenalties?: TimePenaltyRow[];
  merkScores?: MerkScoreRow[];
  diversenCount?: number;
}

// --- QR codes for the participants' app ------------------------------------

// One participant's code for one stage, as the QR page reads it.
export interface CardAccessRow {
  eq: number;
  // Null until an official has generated the codes of this stage.
  code: string | null;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  // When the card was handed in from the app; a code accepts one submission
  // until an official reopens it.
  submittedAt: string | null;
  hasSheet: boolean;
}

export interface StageAccessCodes {
  rally: { _id: string; name: string; code: string };
  stage: {
    _id: string;
    name: string;
    // What the app sends back, and what the participant sees, respectively.
    cardId: number;
    cardNumber: number;
  };
  cards: CardAccessRow[];
}

// --- WPT overview -----------------------------------------------------------

// One of the 10 time rows of a stage, as the rally's WPT overview shows it:
// which control it is and the IPT 0 the stage key holds for it.
export interface RallyTimeColumn {
  rowNumber: number;
  label: string;
  kind: TimeRowKind;
  ipt0: string;
  // False when the stage does not use this row as a checkpoint (no IPT 0).
  active: boolean;
}

// One crew's time on one control, read off the stored sheet — never recomputed,
// so the overview and the card show the same numbers.
export interface RallyTimeCell {
  rowNumber: number;
  ipt: string;
  wpt: string;
  plusMinus: string;
  strafp: number;
  outOfWindow: boolean;
  missing: boolean;
}

export interface RallyTimeEntry {
  eq: number;
  // False when this crew has no sheet for the stage at all.
  hasSheet: boolean;
  timePenalty: number;
  disqualified: boolean;
  startDelta: number;
  endDelta: number;
  cells: RallyTimeCell[];
}

export interface RallyTimeStage {
  _id: string;
  name: string;
  // The route (leg) this stage is ridden in. Null on a rally with no routes.
  routeId?: string | null;
  columns: RallyTimeColumn[];
  entries: RallyTimeEntry[];
}

export interface RallyTimes {
  rally: { _id: string; name: string };
  // The rally's legs, in the order they are ridden. Empty on a rally with no
  // routes, so the grid draws the header rows it always drew.
  routes: StandingsRoute[];
  // In running order, the same order the stage list shows: the routes in their
  // order, and inside a route its stages in theirs.
  stages: RallyTimeStage[];
  participants: {
    eq: number;
    classification: ClassificationValue;
    driverName: string;
    navigatorName: string;
  }[];
}
