import React, { useState, useEffect } from 'react';

interface Quiz {
  _id: string;
  name: string;
}

interface ParticipantFormProps {
  onSubmit: (participantData: {
    eq: number;
    quizId: string;
    answers: { rowNumber: number; selectedAnswers: string[] }[];
  }) => void;
  quizzes: Quiz[];
}

const ParticipantForm: React.FC<ParticipantFormProps> = ({ onSubmit, quizzes }) => {
  const [eq, setEq] = useState<number | ''>('');
  const [quizId, setQuizId] = useState('');
  const [answers, setAnswers] = useState(
    Array.from({ length: 40 }, (_, index) => ({
      rowNumber: index + 1,
      selectedAnswers: ['', '', '', ''] // 4 columns per row
    }))
  );

  // Set the first quiz as selected by default when quizzes are loaded
  useEffect(() => {
    if (quizzes.length > 0 && !quizId) {
      setQuizId(quizzes[0]._id);
    }
  }, [quizzes, quizId]);

  const handleAnswerChange = (rowIndex: number, colIndex: number, value: string) => {
    const newAnswers = [...answers];
    
    // Update the specific answer
    newAnswers[rowIndex].selectedAnswers[colIndex] = value.toUpperCase();
    
    setAnswers(newAnswers);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate EQ
    if (eq === '' || isNaN(Number(eq)) || Number(eq) < 1 || Number(eq) > 100) {
      alert('Please enter a valid participant ID (1-100)');
      return;
    }
    
    // Validate quiz selection
    if (!quizId) {
      alert('Please select a quiz');
      return;
    }
    
    // Process the answers to include only non-empty values
    const processedAnswers = answers.map(row => ({
      rowNumber: row.rowNumber,
      selectedAnswers: row.selectedAnswers.filter(answer => answer.trim() !== '')
    }));
    
    onSubmit({
      eq: Number(eq),
      quizId,
      answers: processedAnswers
    });
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <label htmlFor="eq" className="block text-sm font-medium mb-2">
            Participant ID (1-100)
          </label>
          <input
            type="number"
            id="eq"
            min={1}
            max={100}
            className="w-full p-2 border rounded"
            value={eq}
            onChange={(e) => setEq(e.target.value === '' ? '' : Number(e.target.value))}
            required
          />
        </div>
        <div>
          <label htmlFor="quizId" className="block text-sm font-medium mb-2">
            Select Quiz
          </label>
          <select
            id="quizId"
            className="w-full p-2 border rounded"
            value={quizId}
            onChange={(e) => setQuizId(e.target.value)}
            required
          >
            <option value="">Select a quiz</option>
            {quizzes.map((quiz) => (
              <option key={quiz._id} value={quiz._id}>
                {quiz.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4">Participant Answers</h2>
        <div className="border rounded overflow-auto">
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
              {answers.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-2 px-4 border-b">{rowIndex + 1}</td>
                  {[0, 1, 2, 3].map((colIndex) => (
                    <td key={colIndex} className="py-2 px-4 border-b">
                      <input
                        type="text"
                        className="w-full p-1 border rounded"
                        maxLength={1}
                        value={row.selectedAnswers[colIndex] || ''}
                        onChange={(e) => handleAnswerChange(rowIndex, colIndex, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="text-right">
        <button
          type="submit"
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Submit Answers
        </button>
      </div>
    </form>
  );
};

export default ParticipantForm;