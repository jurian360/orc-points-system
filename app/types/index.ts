import type { StageTimeConfig } from '../lib/timeScoring';
import type { ClassificationValue } from '../lib/participants';

// Rally types
export interface Rally {
  _id: string;
  name: string;
  createdAt: string;
}

// Stage types (a stage holds the answer key for one leg of a rally)
export interface Stage {
  _id: string;
  rallyId: string;
  name: string;
  createdAt: string;
  scoreKey: ScoreKeyRow[];
  timeScoreKey?: TimeScoreKeyRow[];
  merkScoreKey?: MerkScoreKeyRow[];
  timeConfig?: StageTimeConfig;
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

// "Merk" reference row for additional scoring by officials.
export interface MerkScoreKeyRow {
  rowNumber: number;
  merk: string;
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
}

// "Merk" scoring row filled in by officials.
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
  // The two parts of `totalPenalty`: the ORC's (letters) and the time penalty.
  orcPenalty: number;
  timePenalty: number;
  sheetsSubmitted: number;
  disqualified: boolean;
  rank: number;
}

// Form submission types
export interface RallyFormData {
  name: string;
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
