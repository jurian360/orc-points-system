// Update the models/index.ts file

import mongoose from 'mongoose';

// Define the schema for a quiz
const QuizSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
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
  // UI only for now; scoring logic to be added later.
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

// Define the schema for participant answers
const ParticipantAnswerSchema = new mongoose.Schema({
  eq: {
    type: Number,
    required: true,
    min: 1,
    max: 100,
  },
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
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
  // UI only for now; scoring logic to be added later.
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
  penalties: {
    type: Number,
    default: 0
  } // Total penalty points for this participant
});

// Create models if they don't already exist
export const Quiz = mongoose.models.Quiz || mongoose.model('Quiz', QuizSchema);
export const ParticipantAnswer = mongoose.models.ParticipantAnswer || 
  mongoose.model('ParticipantAnswer', ParticipantAnswerSchema);