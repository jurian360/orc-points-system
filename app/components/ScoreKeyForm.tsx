import React, { useState } from 'react';

interface ScoreKeyFormProps {
  onSubmit: (quizName: string, scoreKey: any[]) => void;
  initialData?: {
    name: string;
    scoreKey: {
      rowNumber: number;
      answers: string[];
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
    
    // Create 40 rows with empty answers arrays
    return Array.from({ length: 40 }, (_, index) => ({
      rowNumber: index + 1,
      answers: ['', '', '', ''] // 4 columns per row
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
      answers: row.answers.filter(answer => answer.trim() !== '')
    }));
    
    onSubmit(quizName, processedScoreKey);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto p-4">
      <div className="mb-6">
        <label htmlFor="quizName" className="block text-sm font-medium mb-2">
          Quiz Name
        </label>
        <input
          type="text"
          id="quizName"
          className="w-full p-2 border rounded"
          value={quizName}
          onChange={(e) => setQuizName(e.target.value)}
          required
        />
      </div>
      
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4">Score Key (40 rows with 4 columns each)</h2>
        <div className="border rounded overflow-hidden">
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
              {scoreKey.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="py-2 px-4 border-b">{rowIndex + 1}</td>
                  {[0, 1, 2, 3].map((colIndex) => (
                    <td key={colIndex} className="py-2 px-4 border-b">
                      <input
                        type="text"
                        className="w-full p-1 border rounded"
                        maxLength={1}
                        value={row.answers[colIndex] || ''}
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
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {isEditing ? 'Update Score Key' : 'Save Score Key'}
        </button>
      </div>
    </form>
  );
};

export default ScoreKeyForm;