import React from 'react';

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

interface ParticipantAnswersViewProps {
  participantId: number;
  scoreKey: ScoreKeyRow[];
  participantAnswers: ParticipantAnswerRow[];
}

const ParticipantAnswersView: React.FC<ParticipantAnswersViewProps> = ({
  participantId,
  scoreKey,
  participantAnswers,
}) => {
  // Function to determine if an answer is correct
  const isAnswerCorrect = (rowNumber: number, colIndex: number, answer: string): boolean => {
    if (!answer) return false;
    
    const scoreKeyRow = scoreKey.find(row => row.rowNumber === rowNumber);
    if (!scoreKeyRow) return false;
    
    return scoreKeyRow.answers[colIndex] === answer;
  };

  // Function to determine if an answer is explicitly marked as false
  const isAnswerFalse = (rowNumber: number, colIndex: number, answer: string): boolean => {
    if (!answer) return false;
    
    const scoreKeyRow = scoreKey.find(row => row.rowNumber === rowNumber);
    if (!scoreKeyRow || !scoreKeyRow.falseAnswers) return false;
    
    return scoreKeyRow.falseAnswers.some(
      fa => fa.column === colIndex && fa.value === answer
    );
  };

  // Find a participant answer for a specific row
  const findParticipantAnswer = (rowNumber: number): ParticipantAnswerRow | undefined => {
    return participantAnswers.find(answer => answer.rowNumber === rowNumber);
  };

  // Calculate total penalties
  const calculatePenalties = (): number => {
    let totalPenalties = 0;
    
    scoreKey.forEach(row => {
      const participantAnswer = findParticipantAnswer(row.rowNumber);
      if (!participantAnswer) return;
      
      let rowPenalty = 0;
      
      // Check for false answers and add penalties
      participantAnswer.selectedAnswers.forEach((answer, index) => {
        if (isAnswerFalse(row.rowNumber, index, answer)) {
          rowPenalty += 1; // Add 1 point penalty for each false answer
        }
      });
      
      // Apply maximum penalty cap for this row
      if (row.maxPenalty !== undefined && rowPenalty > row.maxPenalty) {
        rowPenalty = row.maxPenalty;
      }
      
      totalPenalties += rowPenalty;
    });
    
    return totalPenalties;
  };

  const totalPenalties = calculatePenalties();

  return (
    <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200">
      <div className="p-8">
        <h2 className="text-3xl font-bold mb-2 text-gray-800">
          Participant {participantId}'s Answers
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
              {scoreKey.map((row) => {
                const participantAnswer = findParticipantAnswer(row.rowNumber);
                
                // Calculate row penalties
                let rowPenalties = 0;
                if (participantAnswer) {
                  participantAnswer.selectedAnswers.forEach((answer, index) => {
                    if (isAnswerFalse(row.rowNumber, index, answer)) {
                      rowPenalties += 1;
                    }
                  });
                  
                  // Apply maximum penalty cap
                  if (row.maxPenalty !== undefined && rowPenalties > row.maxPenalty) {
                    rowPenalties = row.maxPenalty;
                  }
                }
                
                return (
                  <tr key={row.rowNumber} className={(row.rowNumber % 2 === 0) ? 'bg-gray-50' : 'bg-white'}>
                    <td className="py-4 px-6 border-2 border-gray-300 font-bold text-xl text-gray-800">{row.rowNumber}</td>
                    {[0, 1, 2, 3].map((colIndex) => {
                      const answer = participantAnswer?.selectedAnswers[colIndex] || '';
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
    </div>
  );
};

export default ParticipantAnswersView;