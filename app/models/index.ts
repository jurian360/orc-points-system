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
  }
});

// Create models if they don't already exist
export const Quiz = mongoose.models.Quiz || mongoose.model('Quiz', QuizSchema);
export const ParticipantAnswer = mongoose.models.ParticipantAnswer || 
  mongoose.model('ParticipantAnswer', ParticipantAnswerSchema);