import React from 'react';

interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
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

  // Find a participant answer for a specific row
  const findParticipantAnswer = (rowNumber: number): ParticipantAnswerRow | undefined => {
    return participantAnswers.find(answer => answer.rowNumber === rowNumber);
  };

  return (
    <div className="bg-white rounded-xl shadow-xl overflow-hidden border-2 border-gray-200">
      <div className="p-8">
        <h2 className="text-3xl font-bold mb-6 text-gray-800">
          Participant {participantId}'s Answers
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-purple-100">
                <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Row</th>
                <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 1</th>
                <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 2</th>
                <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 3</th>
                <th className="py-4 px-6 border-2 border-gray-300 text-left font-bold text-xl text-gray-800">Column 4</th>
              </tr>
            </thead>
            <tbody>
              {scoreKey.map((row) => {
                const participantAnswer = findParticipantAnswer(row.rowNumber);
                
                return (
                  <tr key={row.rowNumber} className={(row.rowNumber % 2 === 0) ? 'bg-gray-50' : 'bg-white'}>
                    <td className="py-4 px-6 border-2 border-gray-300 font-bold text-xl text-gray-800">{row.rowNumber}</td>
                    {[0, 1, 2, 3].map((colIndex) => {
                      const answer = participantAnswer?.selectedAnswers[colIndex] || '';
                      const isCorrect = isAnswerCorrect(row.rowNumber, colIndex, answer);
                      
                      return (
                        <td key={colIndex} className="py-4 px-6 border-2 border-gray-300">
                          {answer ? (
                            <div
                              className={`w-16 h-16 flex items-center justify-center rounded-lg shadow-md border-2 ${
                                isCorrect 
                                  ? 'bg-green-100 text-green-800 border-green-400' 
                                  : 'bg-red-100 text-red-800 border-red-400'
                              }`}
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