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
}

export interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
  falseAnswers?: { column: number; value: string }[];
  maxPenalty?: number;
}

// Time-based scoring reference row (IPT / WPT / +/-).
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
  submittedAt: string;
}

export interface AnswerSheetRow {
  rowNumber: number;
  selectedAnswers: string[];
  strafp?: number;
}

// Time-based penalty entry row (IPT / WPT / +/- / strafpunten).
export interface TimePenaltyRow {
  rowNumber: number;
  ipt: string;
  wpt: string;
  plusMinus: string;
  strafp: number;
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
  totalPenalty: number;
  sheetsSubmitted: number;
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
}

export interface AnswerSheetFormData {
  eq: number;
  rallyId: string;
  stageId: string;
  answers: AnswerSheetRow[];
  timePenalties?: TimePenaltyRow[];
  merkScores?: MerkScoreRow[];
}
