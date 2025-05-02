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