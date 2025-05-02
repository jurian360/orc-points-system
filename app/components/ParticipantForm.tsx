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
    
    // Update the specific answer - convert to uppercase
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

  // Only show first 10 rows initially to make the form more manageable
  const visibleRows = 10;

  return (
    <form onSubmit={handleSubmit} className="max-w-6xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div>
          <label htmlFor="eq" className="block text-xl font-semibold mb-3 text-gray-800">
            Participant ID (1-100)
          </label>
          <input
            type="number"
            id="eq"
            min={1}
            max={100}
            className="w-full p-4 border-2 border-gray-300 rounded-lg shadow-sm text-xl focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={eq}
            onChange={(e) => setEq(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Enter ID (1-100)"
            required
          />
        </div>
        <div>
          <label htmlFor="quizId" className="block text-xl font-semibold mb-3 text-gray-800">
            Select Quiz
          </label>
          <select
            id="quizId"
            className="w-full p-4 border-2 border-gray-300 rounded-lg shadow-sm text-xl focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
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
      
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-6 text-gray-800">Participant Answers</h2>
        <p className="mb-4 text-lg text-gray-700">Enter single letter answers (A, B, C, etc.) for each applicable column.</p>
        
        <div className="border-2 border-gray-300 rounded-lg shadow-lg overflow-hidden">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-green-100">
                <th className="py-4 px-6 border-b-2 border-r-2 border-gray-300 text-left font-bold text-lg text-gray-800">
                  Row
                </th>
                <th className="py-4 px-6 border-b-2 border-r-2 border-gray-300 text-center font-bold text-lg text-gray-800">
                  Column 1
                </th>
                <th className="py-4 px-6 border-b-2 border-r-2 border-gray-300 text-center font-bold text-lg text-gray-800">
                  Column 2
                </th>
                <th className="py-4 px-6 border-b-2 border-r-2 border-gray-300 text-center font-bold text-lg text-gray-800">
                  Column 3
                </th>
                <th className="py-4 px-6 border-b-2 border-gray-300 text-center font-bold text-lg text-gray-800">
                  Column 4
                </th>
              </tr>
            </thead>
            <tbody>
              {answers.slice(0, visibleRows).map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-4 px-6 border-b-2 border-r-2 border-gray-300 font-bold text-xl text-gray-800">
                    {rowIndex + 1}
                  </td>
                  {[0, 1, 2, 3].map((colIndex) => (
                    <td key={colIndex} className="py-4 px-6 border-b-2 border-r-2 border-gray-300 text-center">
                      <input
                        type="text"
                        className="w-16 h-16 p-0 border-2 border-gray-400 rounded-lg text-center text-3xl font-bold shadow-md focus:border-green-500 focus:ring focus:ring-green-200 text-gray-600"
                        maxLength={1}
                        value={row.selectedAnswers[colIndex] || ''}
                        onChange={(e) => handleAnswerChange(rowIndex, colIndex, e.target.value)}
                        aria-label={`Answer for row ${rowIndex + 1}, column ${colIndex + 1}`}
                        style={{ fontSize: '24px' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          
          {/* Indication that there are more rows */}
          {answers.length > visibleRows && (
            <div className="p-4 text-center bg-gray-100 border-t-2 border-gray-300">
              <p className="text-gray-600 text-lg">
                Showing first {visibleRows} rows out of 40. Scroll down to see more rows.
              </p>
            </div>
          )}
          
          {/* Remaining rows */}
          {answers.length > visibleRows && (
            <table className="min-w-full border-collapse">
              <tbody>
                {answers.slice(visibleRows).map((row, rowIndex) => (
                  <tr key={rowIndex + visibleRows} className={(rowIndex + visibleRows) % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-4 px-6 border-b-2 border-r-2 border-gray-300 font-bold text-xl text-gray-800">
                      {rowIndex + visibleRows + 1}
                    </td>
                    {[0, 1, 2, 3].map((colIndex) => (
                      <td key={colIndex} className="py-4 px-6 border-b-2 border-r-2 border-gray-300 text-center">
                        <input
                          type="text"
                          className="w-16 h-16 p-0 border-2 border-gray-400 rounded-lg text-center text-3xl font-bold shadow-md focus:border-green-500 focus:ring focus:ring-green-200"
                          maxLength={1}
                          value={row.selectedAnswers[colIndex] || ''}
                          onChange={(e) => handleAnswerChange(rowIndex + visibleRows, colIndex, e.target.value)}
                          aria-label={`Answer for row ${rowIndex + visibleRows + 1}, column ${colIndex + 1}`}
                          style={{ fontSize: '24px' }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      
      <div className="text-right mt-8">
        <button
          type="submit"
          className="px-8 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xl shadow-lg transition duration-150"
        >
          Submit Answers
        </button>
      </div>
    </form>
  );
};

export default ParticipantForm;