// Quiz types
export interface Quiz {
    _id: string;
    name: string;
    createdAt: string;
    scoreKey: ScoreKeyRow[];
  }
  
  export interface ScoreKeyRow {
    rowNumber: number;
    answers: string[];
  }
  
  // Participant types
  export interface ParticipantAnswer {
    _id: string;
    eq: number;
    quizId: string;
    answers: ParticipantAnswerRow[];
    submittedAt: string;
  }
  
  export interface ParticipantAnswerRow {
    rowNumber: number;
    selectedAnswers: string[];
  }
  
  // Form submission types
  export interface QuizFormData {
    name: string;
    scoreKey: ScoreKeyRow[];
  }
  
  export interface ParticipantFormData {
    eq: number;
    quizId: string;
    answers: ParticipantAnswerRow[];
  }