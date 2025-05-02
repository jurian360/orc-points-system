import React, { useState } from 'react';

interface ScoreKeyFormProps {
  onSubmit: (quizName: string, scoreKey: any[]) => void;
  initialData?: {
    name: string;
    scoreKey: {
      rowNumber: number;
      answers: string[];
      falseAnswers?: { column: number, value: string }[];
      maxPenalty?: number;
    }[];
  };
  isEditing?: boolean;
}

const ScoreKeyForm: React.FC<ScoreKeyFormProps> = ({ 
  onSubmit, 
  initialData, 
  isEditing = false 
}) => {
  const [quizName, setQuizName] = useState(initialData?.name || '');
  
  // Initialize scoreKey state with default values or initialData
  const [scoreKey, setScoreKey] = useState(() => {
    if (initialData?.scoreKey?.length) {
      return initialData.scoreKey;
    }
    
    // Create 40 rows with empty answers arrays and new properties
    return Array.from({ length: 40 }, (_, index) => ({
      rowNumber: index + 1,
      answers: ['', '', '', ''], // 4 columns per row
      falseAnswers: [], // array to store false answers for each column
      maxPenalty: 0 // default max penalty points for the row
    }));
  });

  const handleAnswerChange = (rowIndex: number, colIndex: number, value: string) => {
    const newScoreKey = [...scoreKey];
    
    // Ensure the row's answers array exists
    if (!newScoreKey[rowIndex].answers) {
      newScoreKey[rowIndex].answers = ['', '', '', ''];
    }
    
    // Update the specific answer
    newScoreKey[rowIndex].answers[colIndex] = value.toUpperCase();
    
    setScoreKey(newScoreKey);
  };

  const handleFalseAnswerChange = (rowIndex: number, colIndex: number, value: string) => {
    const newScoreKey = [...scoreKey];
    
    // Ensure the falseAnswers array exists
    if (!newScoreKey[rowIndex].falseAnswers) {
      newScoreKey[rowIndex].falseAnswers = [];
    }
    
    // Check if we already have a false answer for this column
    const existingIndex = newScoreKey[rowIndex].falseAnswers.findIndex(
      fa => fa.column === colIndex
    );
    
    if (value === '') {
      // If the value is empty, remove the entry if it exists
      if (existingIndex !== -1) {
        newScoreKey[rowIndex].falseAnswers.splice(existingIndex, 1);
      }
    } else {
      // If we have an existing entry, update it
      if (existingIndex !== -1) {
        newScoreKey[rowIndex].falseAnswers[existingIndex].value = value.toUpperCase();
      } else {
        // Otherwise add a new entry
        newScoreKey[rowIndex].falseAnswers.push({
          column: colIndex,
          value: value.toUpperCase()
        });
      }
    }
    
    setScoreKey(newScoreKey);
  };

  const handleMaxPenaltyChange = (rowIndex: number, value: string) => {
    const newScoreKey = [...scoreKey];
    
    // Convert to number, default to 0 if invalid
    const numValue = parseInt(value, 10);
    newScoreKey[rowIndex].maxPenalty = isNaN(numValue) ? 0 : numValue;
    
    setScoreKey(newScoreKey);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate quiz name
    if (!quizName.trim()) {
      alert('Please enter a quiz name');
      return;
    }
    
    // Process the scoreKey to remove empty answers
    const processedScoreKey = scoreKey.map(row => ({
      rowNumber: row.rowNumber,
      answers: row.answers.filter(answer => answer.trim() !== ''),
      falseAnswers: row.falseAnswers || [],
      maxPenalty: row.maxPenalty || 0
    }));
    
    onSubmit(quizName, processedScoreKey);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <label htmlFor="quizName" className="block text-lg font-medium mb-2 text-gray-800">
          Quiz Name
        </label>
        <input
          type="text"
          id="quizName"
          className="w-full p-3 border border-gray-300 rounded-md shadow-sm text-lg"
          value={quizName}
          onChange={(e) => setQuizName(e.target.value)}
          placeholder="Enter quiz name"
          required
        />
      </div>
      
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4 text-gray-800">Score Key (40 rows with 4 columns each)</h2>
        <div className="border rounded-lg shadow-md overflow-hidden">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-blue-50">
                <th className="py-3 px-4 border-b border-r border-gray-300 text-left font-semibold text-base text-gray-800">Row</th>
                <th className="py-3 px-4 border-b border-r border-gray-300 text-left font-semibold text-base text-gray-800">Column 1</th>
                <th className="py-3 px-4 border-b border-r border-gray-300 text-left font-semibold text-base text-gray-800">Column 2</th>
                <th className="py-3 px-4 border-b border-r border-gray-300 text-left font-semibold text-base text-gray-800">Column 3</th>
                <th className="py-3 px-4 border-b border-r border-gray-300 text-left font-semibold text-base text-gray-800">Column 4</th>
                <th className="py-3 px-4 border-b border-gray-300 text-left font-semibold text-base text-gray-800">Max Penalty</th>
              </tr>
              <tr className="bg-gray-100">
                <th className="py-2 px-4 border-b border-r border-gray-300 text-left text-xs text-gray-600">Row #</th>
                <th className="py-2 px-4 border-b border-r border-gray-300 text-left text-xs text-gray-600">
                  Correct / False
                </th>
                <th className="py-2 px-4 border-b border-r border-gray-300 text-left text-xs text-gray-600">
                  Correct / False
                </th>
                <th className="py-2 px-4 border-b border-r border-gray-300 text-left text-xs text-gray-600">
                  Correct / False
                </th>
                <th className="py-2 px-4 border-b border-r border-gray-300 text-left text-xs text-gray-600">
                  Correct / False
                </th>
                <th className="py-2 px-4 border-b border-gray-300 text-left text-xs text-gray-600">Points</th>
              </tr>
            </thead>
            <tbody>
              {scoreKey.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-3 px-4 border-b border-r border-gray-300 font-medium text-base text-gray-800">
                    {rowIndex + 1}
                  </td>
                  {[0, 1, 2, 3].map((colIndex) => (
                    <td key={colIndex} className="py-3 px-4 border-b border-r border-gray-300">
                      <div className="flex flex-col space-y-2">
                        <div className="flex items-center">
                          <label className="text-xs text-gray-600 mr-2">Correct:</label>
                          <input
                            type="text"
                            className="w-12 h-12 p-1 border border-green-300 rounded-md text-center text-xl font-bold shadow-sm focus:border-green-500 focus:ring focus:ring-green-200"
                            maxLength={1}
                            value={row.answers[colIndex] || ''}
                            onChange={(e) => handleAnswerChange(rowIndex, colIndex, e.target.value)}
                            aria-label={`Correct answer for row ${rowIndex + 1}, column ${colIndex + 1}`}
                          />
                        </div>
                        <div className="flex items-center">
                          <label className="text-xs text-gray-600 mr-2">False:</label>
                          <input
                            type="text"
                            className="w-12 h-12 p-1 border border-red-300 rounded-md text-center text-xl font-bold shadow-sm focus:border-red-500 focus:ring focus:ring-red-200"
                            maxLength={1}
                            value={row.falseAnswers?.find(fa => fa.column === colIndex)?.value || ''}
                            onChange={(e) => handleFalseAnswerChange(rowIndex, colIndex, e.target.value)}
                            aria-label={`False answer for row ${rowIndex + 1}, column ${colIndex + 1}`}
                          />
                        </div>
                      </div>
                    </td>
                  ))}
                  <td className="py-3 px-4 border-b border-gray-300">
                    <input
                      type="number"
                      min="0"
                      className="w-16 h-12 p-1 border border-blue-300 rounded-md text-center text-lg font-bold shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                      value={row.maxPenalty || 0}
                      onChange={(e) => handleMaxPenaltyChange(rowIndex, e.target.value)}
                      aria-label={`Maximum penalty points for row ${rowIndex + 1}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="text-right">
        <button
          type="submit"
          className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-lg shadow-md transition duration-150"
        >
          {isEditing ? 'Update Score Key' : 'Save Score Key'}
        </button>
      </div>
    </form>
  );
};

export default ScoreKeyForm;