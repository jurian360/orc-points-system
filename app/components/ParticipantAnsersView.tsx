import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
  falseAnswers?: { column: number, value: string }[];
  maxPenalty?: number;
}

interface ParticipantAnswerRow {
  rowNumber: number;
  selectedAnswers: string[];
}

interface Quiz {
  _id: string;
  name: string;
  scoreKey: ScoreKeyRow[];
}

interface ParticipantAnswer {
  _id: string;
  eq: number;
  quizId: string;
  answers: ParticipantAnswerRow[];
  submittedAt: string;
}

const ParticipantAnswerView: React.FC = () => {
  const router = useRouter();
  const [quizId, setQuizId] = useState<string>('');
  const [participantId, setParticipantId] = useState<string>('');
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [participants, setParticipants] = useState<{ eq: number, _id: string }[]>([]);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [participantAnswer, setParticipantAnswer] = useState<ParticipantAnswer | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [totalPenalties, setTotalPenalties] = useState<number>(0);

  // Fetch all quizzes
  useEffect(() => {
    const fetchQuizzes = async () => {
      try {
        const response = await fetch('/api/quizzes');
        if (!response.ok) {
          throw new Error('Failed to fetch quizzes');
        }
        const data = await response.json();
        setQuizzes(data);
        
        if (data.length > 0 && !quizId) {
          setQuizId(data[0]._id);
        }
      } catch (err) {
        setError('Failed to load quizzes');
        console.error(err);
      }
    };

    fetchQuizzes();
  }, [quizId]);

  // Fetch participants for selected quiz
  useEffect(() => {
    if (!quizId) return;

    const fetchParticipants = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/participants?quizId=${quizId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch participants');
        }
        const data = await response.json();
        
        // Extract just eq and _id for dropdown
        const participantsList = data.map((p: ParticipantAnswer) => ({ 
          eq: p.eq, 
          _id: p._id 
        }));
        
        setParticipants(participantsList);
        
        // Set default participant if none selected and participants exist
        if (participantsList.length > 0 && !participantId) {
          setParticipantId(participantsList[0]._id);
        }
        
        setLoading(false);
      } catch (err) {
        setError('Failed to load participants');
        console.error(err);
        setLoading(false);
      }
    };

    fetchParticipants();
  }, [quizId, participantId]);

  // Fetch selected quiz details
  useEffect(() => {
    if (!quizId) return;

    const fetchQuiz = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/quizzes/${quizId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch quiz details');
        }
        const data = await response.json();
        setQuiz(data);
        setLoading(false);
      } catch (err) {
        setError('Failed to load quiz details');
        console.error(err);
        setLoading(false);
      }
    };

    fetchQuiz();
  }, [quizId]);

  // Fetch participant answers
  useEffect(() => {
    if (!participantId) return;

    const fetchParticipantAnswer = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/participants/${participantId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch participant answers');
        }
        const data = await response.json();
        setParticipantAnswer(data);
        setLoading(false);
      } catch (err) {
        setError('Failed to load participant answers');
        console.error(err);
        setLoading(false);
      }
    };

    fetchParticipantAnswer();
  }, [participantId]);

  // Calculate penalties when we have both quiz and participant data
  useEffect(() => {
    if (quiz && participantAnswer) {
      let penalties = 0;
      
      // Loop through each row in the score key
      quiz.scoreKey.forEach(scoreKeyRow => {
        // Find matching participant answer row
        const participantRow = participantAnswer.answers.find(
          row => row.rowNumber === scoreKeyRow.rowNumber
        );
        
        if (participantRow) {
          let rowPenalty = 0;
          
          // 1. Check for false answers - apply 30 points for each false answer
          participantRow.selectedAnswers.forEach((answer) => {
            if (answer && scoreKeyRow.falseAnswers) {
              // Check if the answer exists in any false answers for this row
              const isFalse = scoreKeyRow.falseAnswers.some(
                fa => fa.value === answer
              );
              
              if (isFalse) {
                rowPenalty += 30; // Add 30 points for each false answer
              }
            }
          });
          
          // 2. Special case: Check if correct answer appears multiple times
          const correctAnswersByParticipant = participantRow.selectedAnswers.filter(answer => 
            scoreKeyRow.answers.includes(answer)
          );
          
          // If correct answer appears more than the expected number of times, apply penalty
          if (correctAnswersByParticipant.length > scoreKeyRow.answers.length) {
            rowPenalty += 30;
          }
          
          // 3. Check for missing correct answers - apply 30 points for each missing correct answer
          // Create a copy of the correct answers array to track which have been found
          const requiredAnswers = [...scoreKeyRow.answers];
          
          // Remove each found correct answer from the required list
          participantRow.selectedAnswers.forEach((answer) => {
            const index = requiredAnswers.indexOf(answer);
            if (index >= 0) {
              requiredAnswers.splice(index, 1);
            }
          });
          
          // Each remaining required answer counts as a missing answer
          rowPenalty += requiredAnswers.length * 30;
          
          // Apply max penalty cap for this row (only if maxPenalty > 0)
          if (scoreKeyRow.maxPenalty !== undefined && rowPenalty > scoreKeyRow.maxPenalty && scoreKeyRow.maxPenalty > 0) {
            rowPenalty = scoreKeyRow.maxPenalty;
          }
          
          penalties += rowPenalty;
        }
      });
      
      setTotalPenalties(penalties);
    }
  }, [quiz, participantAnswer]);

  // Handler for quiz selection
  const handleQuizChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setQuizId(e.target.value);
    setParticipantId(''); // Reset participant selection when quiz changes
  };

  // Handler for participant selection
  const handleParticipantChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setParticipantId(e.target.value);
  };

  // Function to determine if an answer is correct
  const isAnswerCorrect = (rowNumber: number, colIndex: number, answer: string): boolean => {
    if (!answer || !quiz) return false;
    
    const scoreKeyRow = quiz.scoreKey.find(row => row.rowNumber === rowNumber);
    if (!scoreKeyRow) return false;
    
    return scoreKeyRow.answers[colIndex] === answer;
  };

  // Function to determine if an answer is explicitly marked as false
  const isAnswerFalse = (rowNumber: number, colIndex: number, answer: string): boolean => {
    if (!answer || !quiz) return false;
    
    const scoreKeyRow = quiz.scoreKey.find(row => row.rowNumber === rowNumber);
    if (!scoreKeyRow || !scoreKeyRow.falseAnswers) return false;
    
    // Check if this answer is a false answer regardless of column
    return scoreKeyRow.falseAnswers.some(fa => fa.value === answer);
  };

  // Calculate row penalties
  const calculateRowPenalties = (rowNumber: number): number => {
    if (!quiz || !participantAnswer) return 0;
    
    const scoreKeyRow = quiz.scoreKey.find(row => row.rowNumber === rowNumber);
    const participantRow = participantAnswer.answers.find(row => row.rowNumber === rowNumber);
    
    if (!scoreKeyRow || !participantRow) return 0;
    
    let rowPenalty = 0;
    
    // 1. Check for false answers - apply 30 points for each false answer
    participantRow.selectedAnswers.forEach((answer) => {
      if (answer && scoreKeyRow.falseAnswers) {
        // Check if this answer is a false answer for this row
        const isFalse = scoreKeyRow.falseAnswers.some(
          fa => fa.value === answer
        );
        
        if (isFalse) {
          rowPenalty += 30; // Add 30 points for each false answer
        }
      }
    });
    
    // 2. Special case: Check if correct answer appears multiple times
    const correctAnswersByParticipant = participantRow.selectedAnswers.filter(answer => 
      scoreKeyRow.answers.includes(answer)
    );
    
    // If correct answer appears more than the expected number of times, apply penalty
    if (correctAnswersByParticipant.length > scoreKeyRow.answers.length) {
      rowPenalty += 30;
    }
    
    // 3. Check for missing correct answers - apply 30 points for each missing correct answer
    // Create a copy of the correct answers array to track which have been found
    const requiredAnswers = [...scoreKeyRow.answers];
    
    // Remove each found correct answer from the required list
    participantRow.selectedAnswers.forEach((answer) => {
      const index = requiredAnswers.indexOf(answer);
      if (index >= 0) {
        requiredAnswers.splice(index, 1);
      }
    });
    
    // Each remaining required answer counts as a missing answer
    rowPenalty += requiredAnswers.length * 30;
    
    // Apply maximum penalty cap (only if maxPenalty > 0)
    if (scoreKeyRow.maxPenalty !== undefined && rowPenalty > scoreKeyRow.maxPenalty && scoreKeyRow.maxPenalty > 0) {
      rowPenalty = scoreKeyRow.maxPenalty;
    }
    
    return rowPenalty;
  };

  // Find participant answer for a specific row
  const findParticipantAnswer = (rowNumber: number): ParticipantAnswerRow | undefined => {
    if (!participantAnswer) return undefined;
    return participantAnswer.answers.find(answer => answer.rowNumber === rowNumber);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
        <p className="ml-4 text-lg font-medium">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Participant Answer Scoring</h1>
      
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md">
          <p>{error}</p>
        </div>
      )}
      
      <div className="bg-white shadow-lg rounded-lg p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <label htmlFor="quizSelect" className="block text-sm font-medium text-gray-700 mb-2">
              Select Quiz
            </label>
            <select
              id="quizSelect"
              className="w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-600"
              value={quizId}
              onChange={handleQuizChange}
            >
              <option value="">Select a quiz</option>
              {quizzes.map(quiz => (
                <option key={quiz._id} value={quiz._id}>
                  {quiz.name}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label htmlFor="participantSelect" className="block text-sm font-medium text-gray-700 mb-2">
              Select Participant
            </label>
            <select
              id="participantSelect"
              className="w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-600"
              value={participantId}
              onChange={handleParticipantChange}
              disabled={!quizId || participants.length === 0}
            >
              <option value="">Select a participant</option>
              {participants.map(participant => (
                <option key={participant._id} value={participant._id}>
                  Participant {participant.eq}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      
      {quiz && participantAnswer && (
        <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200">
          <div className="p-8">
            <h2 className="text-3xl font-bold mb-2 text-gray-800">
              Participant {participantAnswer.eq}&apos;s Answers for {quiz.name}
            </h2>
            <p className="text-xl font-semibold mb-6 text-red-600">
              Total Penalties: {totalPenalties} points
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-purple-100">
                    <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Row</th>
                    <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 1</th>
                    <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 2</th>
                    <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 3</th>
                    <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 4</th>
                    <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Penalties</th>
                  </tr>
                </thead>
                <tbody>
                  {quiz.scoreKey.map((row) => {
                    const participantRow = findParticipantAnswer(row.rowNumber);
                    const rowPenalties = calculateRowPenalties(row.rowNumber);
                    
                    return (
                      <tr key={row.rowNumber} className={(row.rowNumber % 2 === 0) ? 'bg-gray-50' : 'bg-white'}>
                        <td className="py-4 px-6 border-2 border-gray-300 font-bold text-xl text-gray-800">{row.rowNumber}</td>
                        {[0, 1, 2, 3].map((colIndex) => {
                          const answer = participantRow?.selectedAnswers[colIndex] || '';
                          const isCorrect = isAnswerCorrect(row.rowNumber, colIndex, answer);
                          const isFalse = isAnswerFalse(row.rowNumber, colIndex, answer);
                          
                          let cellClass = 'bg-gray-100 text-gray-400'; // Default for empty
                          let borderClass = 'border-gray-300';
                          
                          if (answer) {
                            if (isCorrect) {
                              cellClass = 'bg-green-100 text-green-800';
                              borderClass = 'border-green-400';
                            } else if (isFalse) {
                              cellClass = 'bg-red-100 text-red-800';
                              borderClass = 'border-red-400';
                            } else {
                              cellClass = 'bg-yellow-100 text-yellow-800';
                              borderClass = 'border-yellow-400';
                            }
                          }
                          
                          return (
                            <td key={colIndex} className="py-4 px-6 border-2 border-gray-300">
                              {answer ? (
                                <div
                                  className={`w-16 h-16 flex items-center justify-center rounded-lg shadow-md border-2 ${cellClass} ${borderClass}`}
                                >
                                  <span className="text-3xl font-bold">{answer}</span>
                                </div>
                              ) : (
                                <div className="w-16 h-16 flex items-center justify-center bg-gray-100 rounded-lg shadow-md border-2 border-gray-300">
                                  <span className="text-2xl text-gray-400">-</span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-4 px-6 border-2 border-gray-300">
                          {rowPenalties > 0 ? (
                            <div className="px-4 py-2 bg-red-100 text-red-800 rounded-lg shadow-sm border border-red-300 font-bold text-xl text-center">
                              {rowPenalties} {rowPenalties === 1 ? 'point' : 'points'}
                            </div>
                          ) : (
                            <div className="px-4 py-2 bg-green-100 text-green-800 rounded-lg shadow-sm border border-green-300 font-bold text-xl text-center">
                              0 points
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="p-4 bg-gray-50 border-t border-gray-200">
            <div className="flex justify-between">
              <Link href="/participants" className="text-blue-600 hover:text-blue-800 font-medium">
                &larr; Back to Participants
              </Link>
              <Link href="/quizzes" className="text-blue-600 hover:text-blue-800 font-medium">
                View All Quizzes &rarr;
              </Link>
            </div>
          </div>
        </div>
      )}

      {(!quiz || !participantAnswer) && quizId && participantId && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
          <p className="text-yellow-700">No data available for the selected quiz and participant.</p>
        </div>
      )}

      {!quizId && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
          <p className="text-blue-700">Please select a quiz to continue.</p>
        </div>
      )}

      {quizId && !participantId && participants.length > 0 && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
          <p className="text-blue-700">Please select a participant to view their answers.</p>
        </div>
      )}

      {quizId && participants.length === 0 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
          <p className="text-yellow-700">No participants found for the selected quiz.</p>
        </div>
      )}
    </div>
  );
};

export default ParticipantAnswerView;