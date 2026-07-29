import React, { useState } from 'react';

interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
  falseAnswers?: { column: number; value: string }[];
  maxPenalty?: number;
}

interface TimeScoreKeyRow {
  rowNumber: number;
  ipt: string;
  wpt: string;
  plusMinus: string;
  maxPenalty?: number;
}

interface MerkScoreKeyRow {
  rowNumber: number;
  merk: string;
  maxPenalty?: number;
}

interface ScoreKeyFormProps {
  onSubmit: (
    quizName: string,
    scoreKey: ScoreKeyRow[],
    timeScoreKey: TimeScoreKeyRow[],
    merkScoreKey: MerkScoreKeyRow[]
  ) => void;
  initialData?: {
    name: string;
    scoreKey: ScoreKeyRow[];
    timeScoreKey?: TimeScoreKeyRow[];
    merkScoreKey?: MerkScoreKeyRow[];
  };
  isEditing?: boolean;
}

// Layout constants matching the SARK controlekaart
const ANSWER_ROWS = 30; // ORC's letters (was 40)
const LETTER_COLUMNS = 4;
const TIME_ROWS = 10; // IPT / WPT / +/- / strafp
const MERK_ROWS = 6; // Merk (officials)

const ScoreKeyForm: React.FC<ScoreKeyFormProps> = ({
  onSubmit,
  initialData,
  isEditing = false,
}) => {
  const [quizName, setQuizName] = useState(initialData?.name || '');

  const [scoreKey, setScoreKey] = useState<ScoreKeyRow[]>(() => {
    if (initialData?.scoreKey?.length) {
      return initialData.scoreKey;
    }
    return Array.from({ length: ANSWER_ROWS }, (_, index) => ({
      rowNumber: index + 1,
      answers: Array(LETTER_COLUMNS).fill(''),
      falseAnswers: [],
      maxPenalty: 0,
    }));
  });

  const [timeScoreKey, setTimeScoreKey] = useState<TimeScoreKeyRow[]>(() => {
    if (initialData?.timeScoreKey?.length) {
      return initialData.timeScoreKey;
    }
    return Array.from({ length: TIME_ROWS }, (_, index) => ({
      rowNumber: index + 1,
      ipt: '',
      wpt: '',
      plusMinus: '',
      maxPenalty: 0,
    }));
  });

  const [merkScoreKey, setMerkScoreKey] = useState<MerkScoreKeyRow[]>(() => {
    if (initialData?.merkScoreKey?.length) {
      return initialData.merkScoreKey;
    }
    return Array.from({ length: MERK_ROWS }, (_, index) => ({
      rowNumber: index + 1,
      merk: '',
      maxPenalty: 0,
    }));
  });

  const handleAnswerChange = (rowIndex: number, colIndex: number, value: string) => {
    setScoreKey((prev) => {
      const next = [...prev];
      const answers = [...(next[rowIndex].answers || Array(LETTER_COLUMNS).fill(''))];
      answers[colIndex] = value.toUpperCase();
      next[rowIndex] = { ...next[rowIndex], answers };
      return next;
    });
  };

  const handleFalseAnswerChange = (rowIndex: number, colIndex: number, value: string) => {
    setScoreKey((prev) => {
      const next = [...prev];
      const falseAnswers = [...(next[rowIndex].falseAnswers || [])];
      const existingIndex = falseAnswers.findIndex((fa) => fa.column === colIndex);

      if (value === '') {
        if (existingIndex !== -1) {
          falseAnswers.splice(existingIndex, 1);
        }
      } else if (existingIndex !== -1) {
        falseAnswers[existingIndex] = { column: colIndex, value: value.toUpperCase() };
      } else {
        falseAnswers.push({ column: colIndex, value: value.toUpperCase() });
      }

      next[rowIndex] = { ...next[rowIndex], falseAnswers };
      return next;
    });
  };

  const handleMaxPenaltyChange = (rowIndex: number, value: string) => {
    setScoreKey((prev) => {
      const next = [...prev];
      const numValue = parseInt(value, 10);
      next[rowIndex] = { ...next[rowIndex], maxPenalty: isNaN(numValue) ? 0 : numValue };
      return next;
    });
  };

  const handleTimeChange = (
    rowIndex: number,
    field: 'ipt' | 'wpt' | 'plusMinus',
    value: string
  ) => {
    setTimeScoreKey((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [field]: value };
      return next;
    });
  };

  const handleTimeMaxPenaltyChange = (rowIndex: number, value: string) => {
    setTimeScoreKey((prev) => {
      const next = [...prev];
      const numValue = parseInt(value, 10);
      next[rowIndex] = { ...next[rowIndex], maxPenalty: isNaN(numValue) ? 0 : numValue };
      return next;
    });
  };

  const handleMerkChange = (rowIndex: number, value: string) => {
    setMerkScoreKey((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], merk: value };
      return next;
    });
  };

  const handleMerkMaxPenaltyChange = (rowIndex: number, value: string) => {
    setMerkScoreKey((prev) => {
      const next = [...prev];
      const numValue = parseInt(value, 10);
      next[rowIndex] = { ...next[rowIndex], maxPenalty: isNaN(numValue) ? 0 : numValue };
      return next;
    });
  };

  // Max penalty totals for the overview box
  const orcTotal = scoreKey.reduce((sum, row) => sum + (row.maxPenalty || 0), 0);
  const tijdTotal = timeScoreKey.reduce((sum, row) => sum + (row.maxPenalty || 0), 0);
  const diversenTotal = merkScoreKey.reduce((sum, row) => sum + (row.maxPenalty || 0), 0);
  const grandTotal = orcTotal + tijdTotal + diversenTotal;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!quizName.trim()) {
      alert('Please enter a quiz name');
      return;
    }

    const processedScoreKey = scoreKey.map((row) => ({
      rowNumber: row.rowNumber,
      answers: row.answers.filter((answer) => answer.trim() !== ''),
      falseAnswers: row.falseAnswers || [],
      maxPenalty: row.maxPenalty || 0,
    }));

    const processedTimeScoreKey = timeScoreKey.map((row) => ({
      rowNumber: row.rowNumber,
      ipt: (row.ipt || '').trim(),
      wpt: (row.wpt || '').trim(),
      plusMinus: (row.plusMinus || '').trim(),
      maxPenalty: row.maxPenalty || 0,
    }));

    const processedMerkScoreKey = merkScoreKey.map((row) => ({
      rowNumber: row.rowNumber,
      merk: (row.merk || '').trim(),
      maxPenalty: row.maxPenalty || 0,
    }));

    onSubmit(quizName, processedScoreKey, processedTimeScoreKey, processedMerkScoreKey);
  };

  // Render one ORC score-key row (letters correct/false + max penalty), used in both columns
  const renderScoreKeyRow = (row: ScoreKeyRow, rowIndex: number) => (
    <tr key={row.rowNumber} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
      <td className="py-2 px-2 border-b border-r border-gray-300 font-medium text-base text-gray-800 text-center w-10">
        {row.rowNumber}
      </td>
      {Array.from({ length: LETTER_COLUMNS }).map((_, colIndex) => (
        <td key={colIndex} className="py-2 px-2 border-b border-r border-gray-300">
          <div className="flex flex-col space-y-1">
            <input
              type="text"
              className="w-10 h-10 p-1 border border-green-300 rounded text-center text-lg font-bold focus:border-green-500 focus:ring-1 focus:ring-green-200 text-gray-700"
              maxLength={1}
              value={row.answers[colIndex] || ''}
              onChange={(e) => handleAnswerChange(rowIndex, colIndex, e.target.value)}
              aria-label={`Correct answer for row ${row.rowNumber}, column ${colIndex + 1}`}
              title="Correct"
            />
            <input
              type="text"
              className="w-10 h-10 p-1 border border-red-300 rounded text-center text-lg font-bold focus:border-red-500 focus:ring-1 focus:ring-red-200 text-gray-700"
              maxLength={1}
              value={row.falseAnswers?.find((fa) => fa.column === colIndex)?.value || ''}
              onChange={(e) => handleFalseAnswerChange(rowIndex, colIndex, e.target.value)}
              aria-label={`False answer for row ${row.rowNumber}, column ${colIndex + 1}`}
              title="False"
            />
          </div>
        </td>
      ))}
      <td className="py-2 px-2 border-b border-gray-300 text-center">
        <input
          type="number"
          min={0}
          className="w-16 h-10 p-1 border border-blue-300 rounded text-center text-base font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
          value={row.maxPenalty || 0}
          onChange={(e) => handleMaxPenaltyChange(rowIndex, e.target.value)}
          aria-label={`Maximum penalty points for row ${row.rowNumber}`}
        />
      </td>
    </tr>
  );

  const scoreKeyHeader = (
    <thead>
      <tr className="bg-blue-50">
        <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800 w-10">
          NR
        </th>
        <th
          colSpan={LETTER_COLUMNS}
          className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800"
        >
          LETTERS (Correct / False)
        </th>
        <th className="py-2 px-2 border-b border-gray-300 text-xs font-semibold text-gray-800">
          Max Penalty
        </th>
      </tr>
    </thead>
  );

  // ORC section split into two columns of 15 rows, like the paper card
  const half = Math.ceil(ANSWER_ROWS / 2);
  const leftRows = scoreKey.slice(0, half);
  const rightRows = scoreKey.slice(half);

  return (
    <form onSubmit={handleSubmit} className="max-w-7xl mx-auto p-6">
      <div className="mb-8">
        <label htmlFor="quizName" className="block text-lg font-medium mb-2 text-gray-800">
          Quiz Name
        </label>
        <input
          type="text"
          id="quizName"
          className="w-full p-3 border border-gray-300 rounded-md shadow-sm text-lg text-gray-800"
          value={quizName}
          onChange={(e) => setQuizName(e.target.value)}
          placeholder="Enter quiz name"
          required
        />
      </div>

      {/* ORC's score key — 30 rows split into two columns */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-2 text-gray-800">
          ORC&apos;s Score Key (30 rows &times; 4 letters)
        </h2>
        <p className="mb-4 text-base text-gray-700">
          Enter the correct answer (green) and any explicit false answer (red) per column, plus the
          max penalty for the row.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[leftRows, rightRows].map((rows, colGroup) => (
            <div
              key={colGroup}
              className="border border-gray-300 rounded-lg shadow-md overflow-x-auto"
            >
              <table className="min-w-full border-collapse">
                {scoreKeyHeader}
                <tbody>
                  {rows.map((row) => renderScoreKeyRow(row, row.rowNumber - 1))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {/* Official use + Merk + Totals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* For official use only — IPT / WPT / +/- reference */}
        <div>
          <h2 className="text-2xl font-semibold mb-2 text-gray-800">For Official Use Only</h2>
          <p className="mb-4 text-base text-gray-700">
            Time-based scoring reference (IPT / WPT / +/-). 10 rows.
          </p>
          <div className="border border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-yellow-100">
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800 w-10">
                    NR
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800">
                    IPT 0
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800">
                    WPT
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800">
                    +/-
                  </th>
                  <th className="py-2 px-2 border-b border-gray-300 text-xs font-semibold text-gray-800">
                    Max Penalty
                  </th>
                </tr>
              </thead>
              <tbody>
                {timeScoreKey.map((row, rowIndex) => (
                  <tr
                    key={row.rowNumber}
                    className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="py-2 px-2 border-b border-r border-gray-300 font-medium text-base text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    {(['ipt', 'wpt', 'plusMinus'] as const).map((field) => (
                      <td
                        key={field}
                        className="py-2 px-1 border-b border-r border-gray-300 text-center"
                      >
                        <input
                          type="text"
                          className="w-20 h-10 p-1 border border-gray-300 rounded text-center text-base focus:border-yellow-500 focus:ring-1 focus:ring-yellow-200 text-gray-700"
                          value={row[field] || ''}
                          onChange={(e) => handleTimeChange(rowIndex, field, e.target.value)}
                          aria-label={`${field} for time row ${row.rowNumber}`}
                        />
                      </td>
                    ))}
                    <td className="py-2 px-1 border-b border-gray-300 text-center">
                      <input
                        type="number"
                        min={0}
                        className="w-16 h-10 p-1 border border-blue-300 rounded text-center text-base font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
                        value={row.maxPenalty || 0}
                        onChange={(e) => handleTimeMaxPenaltyChange(rowIndex, e.target.value)}
                        aria-label={`Max penalty for time row ${row.rowNumber}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Merk reference + Totaal overview */}
        <div>
          <h2 className="text-2xl font-semibold mb-2 text-gray-800">Merk</h2>
          <p className="mb-4 text-base text-gray-700">
            Additional scoring by officials. 6 rows.
          </p>
          <div className="border border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-orange-100">
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800 w-10">
                    NR
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800">
                    MERK
                  </th>
                  <th className="py-2 px-2 border-b border-gray-300 text-xs font-semibold text-gray-800">
                    Max Penalty
                  </th>
                </tr>
              </thead>
              <tbody>
                {merkScoreKey.map((row, rowIndex) => (
                  <tr
                    key={row.rowNumber}
                    className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="py-2 px-2 border-b border-r border-gray-300 font-medium text-base text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    <td className="py-2 px-1 border-b border-r border-gray-300 text-center">
                      <input
                        type="text"
                        className="w-full min-w-[8rem] h-10 p-1 border border-gray-300 rounded text-base focus:border-orange-500 focus:ring-1 focus:ring-orange-200 text-gray-700"
                        value={row.merk || ''}
                        onChange={(e) => handleMerkChange(rowIndex, e.target.value)}
                        aria-label={`Merk label for row ${row.rowNumber}`}
                      />
                    </td>
                    <td className="py-2 px-1 border-b border-gray-300 text-center">
                      <input
                        type="number"
                        min={0}
                        className="w-16 h-10 p-1 border border-blue-300 rounded text-center text-base font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
                        value={row.maxPenalty || 0}
                        onChange={(e) => handleMerkMaxPenaltyChange(rowIndex, e.target.value)}
                        aria-label={`Max penalty for merk row ${row.rowNumber}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totaal Strafpunten overview (max penalties) */}
          <div className="mt-6 border-2 border-gray-800 rounded-lg overflow-hidden shadow-md">
            <div className="bg-gray-800 text-white py-2 px-4 text-center font-bold text-lg tracking-wide">
              TOTAAL STRAFPUNTEN (MAX)
            </div>
            <table className="min-w-full border-collapse">
              <tbody>
                <tr>
                  <td className="py-2 px-4 border-b border-r border-gray-300 font-semibold text-gray-800">
                    ORC&apos;s
                  </td>
                  <td className="py-2 px-4 border-b border-gray-300 text-right font-bold text-xl text-gray-900 w-24">
                    {orcTotal}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-4 border-b border-r border-gray-300 font-semibold text-gray-800">
                    Tijd
                  </td>
                  <td className="py-2 px-4 border-b border-gray-300 text-right font-bold text-xl text-gray-900">
                    {tijdTotal}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-4 border-b border-r border-gray-300 font-semibold text-gray-800">
                    Diversen
                  </td>
                  <td className="py-2 px-4 border-b border-gray-300 text-right font-bold text-xl text-gray-900">
                    {diversenTotal}
                  </td>
                </tr>
                <tr className="bg-gray-100">
                  <td className="py-3 px-4 border-r border-gray-300 font-bold text-lg text-gray-900">
                    Totaal
                  </td>
                  <td className="py-3 px-4 text-right font-extrabold text-2xl text-red-600">
                    {grandTotal}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
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
