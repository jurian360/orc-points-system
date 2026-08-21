// Data models for the ORC rally points system.
//
// Structure:
//   Rally  -> the top-level event an admin creates first
//   Stage  -> a rally has many stages; each stage holds an answer key
//   AnswerSheet -> a participant's filled-in sheet for a single stage.
//                  A participant (eq) can have many answer sheets per rally
//                  (one per stage). The rally winner is decided by the sum of
//                  the penalty points of all of a participant's answer sheets.

import 'server-only';

import mongoose from 'mongoose';

// A rally is the top-level event. Stages and answer sheets hang off of it.
const RallySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// A stage belongs to a rally and carries the answer key (score key) used to
// score the participant answer sheets submitted for that stage.
const StageSchema = new mongoose.Schema({
  rallyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rally',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  scoreKey: [{
    rowNumber: Number,
    answers: [String], // Array of up to 4 correct answers for each row
    falseAnswers: [{
      column: Number,
      value: String
    }], // Array of false answers for each column
    maxPenalty: {
      type: Number,
      default: 0
    } // Maximum penalty points for the row
  }],
  // Time key of the stage, 10 rows: `ipt` is the ideal passage time of
  // participant 0 — every other participant's ideal time is that plus their eq
  // in minutes. Row 1 is the start, rows 2-9 are the GTC's the stage uses (a
  // row without an `ipt` is not a checkpoint) and row 10 is the finish.
  // `wpt` / `plusMinus` / `maxPenalty` are the officials' pre-refactor
  // reference cells; scoring uses `ipt` and `timeConfig`.
  timeScoreKey: [{
    rowNumber: Number,
    ipt: String,
    wpt: String,
    plusMinus: String,
    maxPenalty: {
      type: Number,
      default: 0
    }
  }],
  // Time-penalty settings of the stage (see app/lib/timeScoring.ts). The
  // defaults are the standard rally limits; `breakMinutes` is the length of the
  // break after this stage and only applies while it is not the last stage.
  timeConfig: {
    breakMinutes: { type: Number, default: 0 },
    gtcEarlyWindow: { type: Number, default: 15 },
    gtcLateWindow: { type: Number, default: 30 },
    finishEarlyWindow: { type: Number, default: 15 },
    finishLateWindow: { type: Number, default: 60 },
    outOfWindowPenalty: { type: Number, default: 60 },
  },
  // "Merk" reference rows for additional scoring by officials, 6 rows.
  merkScoreKey: [{
    rowNumber: Number,
    merk: String,
    maxPenalty: {
      type: Number,
      default: 0
    }
  }],
});

// An answer sheet is a participant's submission for one stage of a rally.
const AnswerSheetSchema = new mongoose.Schema({
  eq: {
    type: Number,
    required: true,
    min: 1,
    max: 100,
  },
  rallyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rally',
    required: true,
    index: true,
  },
  stageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stage',
    required: true,
    index: true,
  },
  answers: [{
    rowNumber: Number,
    selectedAnswers: [String], // Array of selected answers (up to 4 per row)
    strafp: {
      type: Number,
      default: 0
    } // ORC penalty points for the row
  }],
  // Time rows, 10 of them. Officials type the `wpt` (the time the participant
  // actually passed the control); `ipt`, `plusMinus` and `strafp` are computed
  // server-side from the stage's time key and stored so the card renders the
  // same numbers the total was built from.
  timePenalties: [{
    rowNumber: Number,
    ipt: String,
    wpt: String,
    plusMinus: String,
    strafp: {
      type: Number,
      default: 0
    },
    outOfWindow: {
      type: Boolean,
      default: false
    }
  }],
  // "Merk" scoring by officials, 6 rows.
  merkScores: [{
    rowNumber: Number,
    merk: String,
    strafp: {
      type: Number,
      default: 0
    }
  }],
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  // Total penalty points for this answer sheet: the ORC's penalty computed from
  // the stage's answer key plus the time penalty computed from its time key.
  // Summed across a participant's sheets to rank the rally standings.
  totalPenalty: {
    type: Number,
    default: 0
  },
  // The time part of totalPenalty, kept separately so the card can show the
  // "Tijd" line without recomputing the whole chain.
  timePenalty: {
    type: Number,
    default: 0
  },
  // The participant missed the finish window of the last stage.
  disqualified: {
    type: Boolean,
    default: false
  },
  // Running time delta (in minutes) carried into and out of this stage. Stored
  // for transparency: the delta of a stage depends on every earlier stage.
  startDelta: {
    type: Number,
    default: 0
  },
  endDelta: {
    type: Number,
    default: 0
  }
});

// A participant fills in at most one sheet per stage.
AnswerSheetSchema.index({ stageId: 1, eq: 1 }, { unique: true });

// Create models if they don't already exist
export const Rally = mongoose.models.Rally || mongoose.model('Rally', RallySchema);
export const Stage = mongoose.models.Stage || mongoose.model('Stage', StageSchema);
export const AnswerSheet = mongoose.models.AnswerSheet ||
  mongoose.model('AnswerSheet', AnswerSheetSchema);
