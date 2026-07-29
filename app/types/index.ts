// Quiz types
export interface Quiz {
    _id: string;
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

  // Time-based scoring reference row (IPT / WPT / +/-). UI only for now.
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

  // Participant types
  export interface ParticipantAnswer {
    _id: string;
    eq: number;
    quizId: string;
    answers: ParticipantAnswerRow[];
    timePenalties?: TimePenaltyRow[];
    merkScores?: MerkScoreRow[];
    submittedAt: string;
  }

  export interface ParticipantAnswerRow {
    rowNumber: number;
    selectedAnswers: string[];
    strafp?: number;
  }

  // Time-based penalty entry row (IPT / WPT / +/- / strafpunten). UI only for now.
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

  // Form submission types
  export interface QuizFormData {
    name: string;
    scoreKey: ScoreKeyRow[];
    timeScoreKey?: TimeScoreKeyRow[];
    merkScoreKey?: MerkScoreKeyRow[];
  }

  export interface ParticipantFormData {
    eq: number;
    quizId: string;
    answers: ParticipantAnswerRow[];
    timePenalties?: TimePenaltyRow[];
    merkScores?: MerkScoreRow[];
  }
