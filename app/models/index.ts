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
  // Time-based scoring reference (IPT / WPT / +/-), 10 rows.
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
  // Time-based penalty entry (IPT / WPT / +/- / strafpunten), 10 rows.
  timePenalties: [{
    rowNumber: Number,
    ipt: String,
    wpt: String,
    plusMinus: String,
    strafp: {
      type: Number,
      default: 0
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
  // Total penalty points for this answer sheet, auto-computed from the stage's
  // answer key at submission time. Summed across a participant's sheets to rank
  // the rally standings.
  totalPenalty: {
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
