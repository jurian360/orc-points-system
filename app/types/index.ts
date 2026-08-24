import type { StageTimeConfig } from '../lib/timeScoring';
import type { ClassificationValue } from '../lib/participants';
import type { ScanLocation, ScanReference } from '../lib/scanLocations';

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

// Stage types (a stage holds the answer key for one leg of a rally)
export interface Stage {
  _id: string;
  rallyId: string;
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
  // Anti-cheat settings for the route QR codes of this stage: how far from its
  // sign a scan may be, and where officials have pinned the signs that need it
  // (see app/lib/scanLocations.ts).
  locationConfig?: { radiusMeters: number };
  scanReferences?: ScanReference[];
}

export interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
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
  totalPenalty: number;
  timePenalty?: number;
  merkPenalty?: number;
  disqualified?: boolean;
  startDelta?: number;
  endDelta?: number;
  // Where the crew's phone was when each route QR code dropped a letter into a
  // row. Recorded by the Android app, never part of a penalty.
  scanLocations?: ScanLocation[];
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
  sheetsSubmitted: number;
  disqualified: boolean;
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
