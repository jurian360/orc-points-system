import type { StageTimeConfig, TimeRowKind } from '../lib/timeScoring';
import type { ClassificationValue } from '../lib/participants';
import type { ClassificationChange, Vehicle } from '../lib/persons';
import type { SeasonSettings } from '../lib/seasons';
import type { CrewSeasonEntry, SeasonRally } from '../lib/overallStandings';
import type { StandingsStatus } from '../lib/standings';

// Rally types
export interface Rally {
  _id: string;
  name: string;
  // Short public identifier, handed to the Android app as its `rallycode` and
  // sent back with a card the participant finalises. Generated on first use, so
  // it is missing on a rally that has never issued a QR code.
  code?: string;
  // The day the rally was ridden, which is what puts it in a season. Missing
  // on a rally created before the field existed; the read paths fall back to
  // `createdAt` rather than dropping it out of its own year.
  date?: string;
  // False for an unofficial rally — ridden and scored like any other, but not
  // counted towards the overall standings of its year.
  countsForSeason?: boolean;
  // How much this rally is worth in the overall standings. 1 is unweighted.
  timeFactor?: number;
  // True for a rally whose results were imported from a historical sheet: it
  // has a finishing order and no stages, cards or strafpunten.
  resultsImported?: boolean;
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

// Participant of a rally: the **crew** registered under an EQ number. Optional
// — an EQ with answer sheets but no record is still scored, it just has no crew
// attached.
//
// `driverId` / `navigatorId` are the two riders (app/lib/persons.ts). They are
// null on an entry typed before the riders were registered, which is what an
// entry-list import produces and what the entry form then fills in. The names
// beside them are copies of the riders' names as they stood at registration —
// see the model for why that copy exists and how it is kept fresh.
export interface Participant {
  _id: string;
  rallyId: string;
  eq: number;
  driverId: string | null;
  navigatorId: string | null;
  // The class the **crew** rides in: the higher of its two riders' on B < A < H.
  classification: ClassificationValue;
  driverClassification: ClassificationValue;
  navigatorClassification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  // The car this crew brought to this rally.
  vehicle: Vehicle;
  createdAt: string;
  updatedAt: string;
}

// What the entry form sends. The crew's class is **not** here: it is derived
// from the two riders server-side, so a form cannot claim a class the pair does
// not hold.
export interface ParticipantFormData {
  eq: number;
  driverId: string | null;
  navigatorId: string | null;
  vehicle: Vehicle;
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
  // The two riders behind this entry, so a season can group the same pair
  // across ten rallies (app/lib/overallStandings.ts). Null on an EQ that was
  // typed straight onto a card without a crew being registered.
  driverId: string | null;
  navigatorId: string | null;
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
  // `YYYY-MM-DD`, the day the rally is ridden.
  date?: string;
  countsForSeason?: boolean;
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

// --- Riders -----------------------------------------------------------------

// One rider as the registry lists them. The password never leaves the API, so
// `hasLogin` is all a view learns about it.
export interface PersonRow {
  _id: string;
  email: string;
  name: string;
  phone: string;
  foodRestrictions: string;
  classification: ClassificationValue;
  classificationChangedAt: string | null;
  hasLogin: boolean;
  createdAt: string;
  updatedAt: string;
}

// A rider with the whole of their classification history, as the detail page
// reads them. The list route leaves the history out — two hundred riders'
// histories is a lot of wire for a column that shows one date.
export interface PersonDetail extends PersonRow {
  classificationHistory: ClassificationChange[];
}

// What the rider form sends. `classification` is deliberately absent: it moves
// through its own route (`PUT /api/persons/[id]/classification`) because it is
// the one field a classification admin may change and the one that writes a
// history entry.
export interface PersonFormData {
  email: string;
  name: string;
  phone: string;
  foodRestrictions: string;
  // Set to give this rider a login, or to reset the one they have. Absent
  // leaves whatever they had alone; `null` takes their login away.
  password?: string | null;
}

// --- A rider's own results --------------------------------------------------

// One rally a rider entered, with who they rode it with and what it cost them.
// The same shape answers `/api/me/results` and
// `/api/persons/[id]/results` — the rider's own dashboard and an official
// looking at that rider — so the two cannot show different histories.
export interface RiderEntry {
  rallyId: string;
  rallyName: string;
  date: string;
  countsForSeason: boolean;
  eq: number;
  // Which seat this rider took. The pair is unordered across a season, but one
  // entry has a driver and a navigator.
  seat: 'driver' | 'navigator';
  // The other half of the crew. Null on an entry whose other seat was never
  // filled in.
  partner: { _id: string; name: string; email: string } | null;
  classification: ClassificationValue;
  vehicle: Vehicle;
  // True when this rally's result was imported from a historical sheet rather
  // than scored here, so a screen can say why there are no strafpunten.
  resultsImported: boolean;
  // What the rally gave this crew. Null while the rally has no result at all —
  // one still being set up, rather than a result of zero.
  result: {
    // Null on an imported rally, which records a finishing order and no
    // points. Not 0: a crew with no recorded strafpunten did not score a
    // perfect card.
    totalPenalty: number | null;
    orcPenalty: number | null;
    timePenalty: number | null;
    merkPenalty: number | null;
    status: StandingsStatus;
    // The place among the crews who finished; 0 for a DNF or a DNS, which have
    // no place.
    rank: number;
    // How many crews were in this rally at all, so a place reads as "7 of 43".
    fieldSize: number;
  } | null;
}

export interface RiderResults {
  person: PersonDetail;
  entries: RiderEntry[];
  // The rider's crews per season, newest year first: who they rode with, how
  // many official rallies they managed together and where that puts them.
  seasons: {
    year: number;
    settings: SeasonSettings;
    crews: CrewSeasonEntry[];
  }[];
}

// --- The overall standings of one season -----------------------------------

export interface OverallStandingsResponse {
  year: number;
  // The years that have a rally in them at all, newest first, so a view can
  // offer a year picker without a second request.
  years: number[];
  settings: SeasonSettings;
  // The official rallies of the year, in the order they were ridden. The
  // unofficial ones are not here: they do not count, and a column for them
  // would say otherwise.
  rallies: SeasonRally[];
  // How many rallies of the year were left out for being unofficial, so the
  // page can say so rather than leaving a reader to wonder.
  unofficialRallies: number;
  entries: CrewSeasonEntry[];
}
