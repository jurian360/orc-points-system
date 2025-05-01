import React from 'react';
import { ScoreKeyRow, ParticipantAnswerRow } from '../types';

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

  // Find a participant answer for a specific row
  const findParticipantAnswer = (rowNumber: number): ParticipantAnswerRow | undefined => {
    return participantAnswers.find(answer => answer.rowNumber === rowNumber);
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">
          Participant {participantId}'s Answers
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-100">
                <th className="py-2 px-4 border-b text-left">Row</th>
                <th className="py-2 px-4 border-b text-left">Column 1</th>
                <th className="py-2 px-4 border-b text-left">Column 2</th>
                <th className="py-2 px-4 border-b text-left">Column 3</th>
                <th className="py-2 px-4 border-b text-left">Column 4</th>
              </tr>
            </thead>
            <tbody>
              {scoreKey.map((row) => {
                const participantAnswer = findParticipantAnswer(row.rowNumber);
                
                return (
                  <tr key={row.rowNumber} className={(row.rowNumber % 2 === 0) ? 'bg-gray-50' : 'bg-white'}>
                    <td className="py-2 px-4 border-b font-medium">{row.rowNumber}</td>
                    {[0, 1, 2, 3].map((colIndex) => {
                      const answer = participantAnswer?.selectedAnswers[colIndex] || '';
                      const isCorrect = isAnswerCorrect(row.rowNumber, colIndex, answer);
                      
                      return (
                        <td key={colIndex} className="py-2 px-4 border-b">
                          {answer ? (
                            <div
                              className={`w-8 h-8 flex items-center justify-center rounded ${
                                isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {answer}
                            </div>
                          ) : (
                            <div className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded">
                              -
                            </div>
                          )}
                        </td>
                      );
                    })}
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