import React, { useState, useEffect } from 'react';

interface Quiz {
  _id: string;
  name: string;
}

interface AnswerRow {
  rowNumber: number;
  selectedAnswers: string[];
  strafp: string;
}

interface TimePenaltyRow {
  rowNumber: number;
  ipt: string;
  wpt: string;
  plusMinus: string;
  strafp: string;
}

interface MerkRow {
  rowNumber: number;
  merk: string;
  strafp: string;
}

interface ParticipantFormProps {
  onSubmit: (participantData: {
    eq: number;
    quizId: string;
    answers: { rowNumber: number; selectedAnswers: string[]; strafp: number }[];
    timePenalties: {
      rowNumber: number;
      ipt: string;
      wpt: string;
      plusMinus: string;
      strafp: number;
    }[];
    merkScores: { rowNumber: number; merk: string; strafp: number }[];
  }) => void;
  quizzes: Quiz[];
}

// Layout constants matching the SARK controlekaart
const ANSWER_ROWS = 30; // ORC's letters (was 40)
const LETTER_COLUMNS = 4;
const TIME_ROWS = 10; // IPT / WPT / +/- / strafp
const MERK_ROWS = 6; // Merk (officials)

const toNumber = (value: string): number => {
  const n = parseInt(value, 10);
  return isNaN(n) ? 0 : n;
};

const ParticipantForm: React.FC<ParticipantFormProps> = ({ onSubmit, quizzes }) => {
  const [eq, setEq] = useState<number | ''>('');
  const [quizId, setQuizId] = useState('');

  const [answers, setAnswers] = useState<AnswerRow[]>(
    Array.from({ length: ANSWER_ROWS }, (_, index) => ({
      rowNumber: index + 1,
      selectedAnswers: Array(LETTER_COLUMNS).fill(''),
      strafp: '',
    }))
  );

  const [timePenalties, setTimePenalties] = useState<TimePenaltyRow[]>(
    Array.from({ length: TIME_ROWS }, (_, index) => ({
      rowNumber: index + 1,
      ipt: '',
      wpt: '',
      plusMinus: '',
      strafp: '',
    }))
  );

  const [merkScores, setMerkScores] = useState<MerkRow[]>(
    Array.from({ length: MERK_ROWS }, (_, index) => ({
      rowNumber: index + 1,
      merk: '',
      strafp: '',
    }))
  );

  // Set the first quiz as selected by default when quizzes are loaded
  useEffect(() => {
    if (quizzes.length > 0 && !quizId) {
      setQuizId(quizzes[0]._id);
    }
  }, [quizzes, quizId]);

  const handleAnswerChange = (rowIndex: number, colIndex: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      const row = { ...next[rowIndex], selectedAnswers: [...next[rowIndex].selectedAnswers] };
      row.selectedAnswers[colIndex] = value.toUpperCase();
      next[rowIndex] = row;
      return next;
    });
  };

  const handleAnswerStrafpChange = (rowIndex: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], strafp: value };
      return next;
    });
  };

  const handleTimeChange = (
    rowIndex: number,
    field: 'ipt' | 'wpt' | 'plusMinus' | 'strafp',
    value: string
  ) => {
    setTimePenalties((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [field]: value };
      return next;
    });
  };

  const handleMerkChange = (rowIndex: number, field: 'merk' | 'strafp', value: string) => {
    setMerkScores((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [field]: value };
      return next;
    });
  };

  // Penalty totals for the "Totaal Strafpunten" overview
  const orcTotal = answers.reduce((sum, row) => sum + toNumber(row.strafp), 0);
  const tijdTotal = timePenalties.reduce((sum, row) => sum + toNumber(row.strafp), 0);
  const diversenTotal = merkScores.reduce((sum, row) => sum + toNumber(row.strafp), 0);
  const grandTotal = orcTotal + tijdTotal + diversenTotal;

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

    const processedAnswers = answers.map((row) => ({
      rowNumber: row.rowNumber,
      selectedAnswers: row.selectedAnswers.filter((answer) => answer.trim() !== ''),
      strafp: toNumber(row.strafp),
    }));

    const processedTimePenalties = timePenalties.map((row) => ({
      rowNumber: row.rowNumber,
      ipt: row.ipt.trim(),
      wpt: row.wpt.trim(),
      plusMinus: row.plusMinus.trim(),
      strafp: toNumber(row.strafp),
    }));

    const processedMerkScores = merkScores.map((row) => ({
      rowNumber: row.rowNumber,
      merk: row.merk.trim(),
      strafp: toNumber(row.strafp),
    }));

    onSubmit({
      eq: Number(eq),
      quizId,
      answers: processedAnswers,
      timePenalties: processedTimePenalties,
      merkScores: processedMerkScores,
    });
  };

  // Render one ORC answer row (letters + strafp) — compact so the whole card fits on screen
  const renderAnswerRow = (row: AnswerRow, rowIndex: number) => (
    <tr key={row.rowNumber} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
      <td className="py-0.5 px-1 border-b border-r border-gray-300 font-bold text-sm text-gray-800 text-center w-7">
        {row.rowNumber}
      </td>
      {Array.from({ length: LETTER_COLUMNS }).map((_, colIndex) => (
        <td key={colIndex} className="py-0.5 px-0.5 border-b border-r border-gray-300 text-center">
          <input
            type="text"
            className="w-9 h-8 p-0 border border-gray-400 rounded text-center text-lg font-bold uppercase focus:border-green-500 focus:ring-1 focus:ring-green-200 text-gray-700"
            maxLength={1}
            value={row.selectedAnswers[colIndex] || ''}
            onChange={(e) => handleAnswerChange(rowIndex, colIndex, e.target.value)}
            aria-label={`Answer for row ${row.rowNumber}, letter ${colIndex + 1}`}
          />
        </td>
      ))}
      <td className="py-0.5 px-0.5 border-b border-gray-300 text-center">
        <input
          type="number"
          min={0}
          className="w-12 h-8 p-0.5 border border-gray-400 rounded text-center text-sm font-semibold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
          value={row.strafp}
          onChange={(e) => handleAnswerStrafpChange(rowIndex, e.target.value)}
          aria-label={`Strafpunten for row ${row.rowNumber}`}
        />
      </td>
    </tr>
  );

  // ORC section is split into two columns of 15 rows, like the paper card
  const half = Math.ceil(ANSWER_ROWS / 2);
  const leftRows = answers.slice(0, half);
  const rightRows = answers.slice(half);

  const answerHeader = (
    <thead>
      <tr className="bg-green-100">
        <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800 w-7">
          NR
        </th>
        <th
          colSpan={LETTER_COLUMNS}
          className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800"
        >
          LETTERS
        </th>
        <th className="py-1 px-1 border-b border-gray-300 text-[10px] font-bold text-gray-800">
          STRAFP.
        </th>
      </tr>
    </thead>
  );

  return (
    <form onSubmit={handleSubmit} className="w-full mx-auto">
      {/* Header — controlekaart style (compact, single row) */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-4">
        <div className="sm:w-48">
          <label htmlFor="eq" className="block text-sm font-semibold mb-1 text-gray-800">
            EQ. No. — Participant ID (1-100)
          </label>
          <input
            type="number"
            id="eq"
            min={1}
            max={100}
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={eq}
            onChange={(e) => setEq(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Enter ID (1-100)"
            required
          />
        </div>
        <div className="sm:w-72">
          <label htmlFor="quizId" className="block text-sm font-semibold mb-1 text-gray-800">
            Select Quiz (Controlekaart)
          </label>
          <select
            id="quizId"
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
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
        <p className="text-sm text-gray-600 sm:ml-auto sm:pb-2">
          Enter single-letter answers per column, plus strafpunten per row.
        </p>
      </div>

      {/* Score card laid out as 4 main columns, like the SARK controlekaart:
          ORC's 1-15 | ORC's 16-30 | For Official Use Only (time) | Merk + totals */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4 items-start">
        {/* Column 1 — ORC's rows 1-15 */}
        <div>
          <h2 className="text-sm font-bold mb-1 text-gray-800">ORC&apos;s (1&ndash;15)</h2>
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              {answerHeader}
              <tbody>
                {leftRows.map((row) => renderAnswerRow(row, row.rowNumber - 1))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 2 — ORC's rows 16-30 */}
        <div>
          <h2 className="text-sm font-bold mb-1 text-gray-800">ORC&apos;s (16&ndash;30)</h2>
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              {answerHeader}
              <tbody>
                {rightRows.map((row) => renderAnswerRow(row, row.rowNumber - 1))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 3 — For official use only (IPT / WPT / +/- / STRAFP) */}
        <div>
          <h2 className="text-sm font-bold mb-1 text-gray-800">For Official Use Only</h2>
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-yellow-100">
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800 w-7">
                    NR
                  </th>
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800">
                    IPT 0
                  </th>
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800">
                    WPT
                  </th>
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800">
                    +/-
                  </th>
                  <th className="py-1 px-1 border-b border-gray-300 text-[10px] font-bold text-gray-800">
                    STRAFP.
                  </th>
                </tr>
              </thead>
              <tbody>
                {timePenalties.map((row, rowIndex) => (
                  <tr
                    key={row.rowNumber}
                    className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="py-0.5 px-1 border-b border-r border-gray-300 font-bold text-sm text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    {(['ipt', 'wpt', 'plusMinus'] as const).map((field) => (
                      <td
                        key={field}
                        className="py-0.5 px-0.5 border-b border-r border-gray-300 text-center"
                      >
                        <input
                          type="text"
                          className="w-14 h-8 p-0.5 border border-gray-400 rounded text-center text-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-200 text-gray-700"
                          value={row[field]}
                          onChange={(e) => handleTimeChange(rowIndex, field, e.target.value)}
                          aria-label={`${field} for time row ${row.rowNumber}`}
                        />
                      </td>
                    ))}
                    <td className="py-0.5 px-0.5 border-b border-gray-300 text-center">
                      <input
                        type="number"
                        min={0}
                        className="w-12 h-8 p-0.5 border border-gray-400 rounded text-center text-sm font-semibold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
                        value={row.strafp}
                        onChange={(e) => handleTimeChange(rowIndex, 'strafp', e.target.value)}
                        aria-label={`Strafpunten for time row ${row.rowNumber}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 4 — Merk (officials) + Totaal Strafpunten */}
        <div>
          <h2 className="text-sm font-bold mb-1 text-gray-800">Merk</h2>
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-orange-100">
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800 w-7">
                    NR
                  </th>
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800">
                    MERK
                  </th>
                  <th className="py-1 px-1 border-b border-gray-300 text-[10px] font-bold text-gray-800">
                    STRAFP.
                  </th>
                </tr>
              </thead>
              <tbody>
                {merkScores.map((row, rowIndex) => (
                  <tr
                    key={row.rowNumber}
                    className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="py-0.5 px-1 border-b border-r border-gray-300 font-bold text-sm text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    <td className="py-0.5 px-0.5 border-b border-r border-gray-300 text-center">
                      <input
                        type="text"
                        className="w-full min-w-[6rem] h-8 p-1 border border-gray-400 rounded text-sm focus:border-orange-500 focus:ring-1 focus:ring-orange-200 text-gray-700"
                        value={row.merk}
                        onChange={(e) => handleMerkChange(rowIndex, 'merk', e.target.value)}
                        aria-label={`Merk for row ${row.rowNumber}`}
                      />
                    </td>
                    <td className="py-0.5 px-0.5 border-b border-gray-300 text-center">
                      <input
                        type="number"
                        min={0}
                        className="w-12 h-8 p-0.5 border border-gray-400 rounded text-center text-sm font-semibold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
                        value={row.strafp}
                        onChange={(e) => handleMerkChange(rowIndex, 'strafp', e.target.value)}
                        aria-label={`Strafpunten for merk row ${row.rowNumber}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totaal Strafpunten overview */}
          <div className="mt-3 border-2 border-gray-800 rounded-lg overflow-hidden shadow-md">
            <div className="bg-gray-800 text-white py-1 px-3 text-center font-bold text-sm tracking-wide">
              TOTAAL STRAFPUNTEN
            </div>
            <table className="min-w-full border-collapse">
              <tbody>
                <tr>
                  <td className="py-1 px-3 border-b border-r border-gray-300 font-semibold text-sm text-gray-800">
                    ORC&apos;s
                  </td>
                  <td className="py-1 px-3 border-b border-gray-300 text-right font-bold text-lg text-gray-900 w-20">
                    {orcTotal}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 px-3 border-b border-r border-gray-300 font-semibold text-sm text-gray-800">
                    Tijd
                  </td>
                  <td className="py-1 px-3 border-b border-gray-300 text-right font-bold text-lg text-gray-900">
                    {tijdTotal}
                  </td>
                </tr>
                <tr>
                  <td className="py-1 px-3 border-b border-r border-gray-300 font-semibold text-sm text-gray-800">
                    Diversen
                  </td>
                  <td className="py-1 px-3 border-b border-gray-300 text-right font-bold text-lg text-gray-900">
                    {diversenTotal}
                  </td>
                </tr>
                <tr className="bg-gray-100">
                  <td className="py-1.5 px-3 border-r border-gray-300 font-bold text-base text-gray-900">
                    Totaal
                  </td>
                  <td className="py-1.5 px-3 text-right font-extrabold text-xl text-red-600">
                    {grandTotal}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Submit lives under the totals so the whole card fits without scrolling */}
          <button
            type="submit"
            className="mt-3 w-full px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-base shadow-lg transition duration-150"
          >
            Submit Answers
          </button>
        </div>
      </div>
    </form>
  );
};

export default ParticipantForm;
