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

  // Render one ORC answer row (letters + strafp)
  const renderAnswerRow = (row: AnswerRow, rowIndex: number) => (
    <tr key={row.rowNumber} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
      <td className="py-1.5 px-2 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center w-10">
        {row.rowNumber}
      </td>
      {Array.from({ length: LETTER_COLUMNS }).map((_, colIndex) => (
        <td key={colIndex} className="py-1.5 px-1 border-b border-r border-gray-300 text-center">
          <input
            type="text"
            className="w-11 h-11 p-0 border border-gray-400 rounded text-center text-2xl font-bold uppercase focus:border-green-500 focus:ring-1 focus:ring-green-200 text-gray-700"
            maxLength={1}
            value={row.selectedAnswers[colIndex] || ''}
            onChange={(e) => handleAnswerChange(rowIndex, colIndex, e.target.value)}
            aria-label={`Answer for row ${row.rowNumber}, letter ${colIndex + 1}`}
          />
        </td>
      ))}
      <td className="py-1.5 px-1 border-b border-gray-300 text-center">
        <input
          type="number"
          min={0}
          className="w-16 h-11 p-1 border border-gray-400 rounded text-center text-base font-semibold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
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
        <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-bold text-gray-800 w-10">
          NR
        </th>
        <th
          colSpan={LETTER_COLUMNS}
          className="py-2 px-2 border-b border-r border-gray-300 text-xs font-bold text-gray-800"
        >
          LETTERS
        </th>
        <th className="py-2 px-2 border-b border-gray-300 text-xs font-bold text-gray-800">
          STRAFP.
        </th>
      </tr>
    </thead>
  );

  return (
    <form onSubmit={handleSubmit} className="max-w-7xl mx-auto">
      {/* Header — controlekaart style */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div>
          <label htmlFor="eq" className="block text-xl font-semibold mb-3 text-gray-800">
            EQ. No. — Participant ID (1-100)
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
            Select Quiz (Controlekaart)
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

      {/* ORC's answers — 30 rows, split into two columns of 15 */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2 text-gray-800">ORC&apos;s — Answers</h2>
        <p className="mb-4 text-base text-gray-700">
          Enter single letter answers (A, B, C, …) for each applicable column. 30 rows total.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[leftRows, rightRows].map((rows, colGroup) => (
            <div
              key={colGroup}
              className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto"
            >
              <table className="min-w-full border-collapse">
                {answerHeader}
                <tbody>
                  {rows.map((row) => renderAnswerRow(row, row.rowNumber - 1))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {/* Official use + Merk + Totals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* For official use only — IPT / WPT / +/- / STRAFP */}
        <div>
          <h2 className="text-2xl font-bold mb-2 text-gray-800">For Official Use Only</h2>
          <p className="mb-4 text-base text-gray-700">
            Time-based penalty points (IPT / WPT / +/-). 10 rows.
          </p>
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-yellow-100">
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-bold text-gray-800 w-10">
                    NR
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-bold text-gray-800">
                    IPT 0
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-bold text-gray-800">
                    WPT
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-bold text-gray-800">
                    +/-
                  </th>
                  <th className="py-2 px-2 border-b border-gray-300 text-xs font-bold text-gray-800">
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
                    <td className="py-1.5 px-2 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    {(['ipt', 'wpt', 'plusMinus'] as const).map((field) => (
                      <td
                        key={field}
                        className="py-1.5 px-1 border-b border-r border-gray-300 text-center"
                      >
                        <input
                          type="text"
                          className="w-20 h-10 p-1 border border-gray-400 rounded text-center text-base focus:border-yellow-500 focus:ring-1 focus:ring-yellow-200 text-gray-700"
                          value={row[field]}
                          onChange={(e) => handleTimeChange(rowIndex, field, e.target.value)}
                          aria-label={`${field} for time row ${row.rowNumber}`}
                        />
                      </td>
                    ))}
                    <td className="py-1.5 px-1 border-b border-gray-300 text-center">
                      <input
                        type="number"
                        min={0}
                        className="w-16 h-10 p-1 border border-gray-400 rounded text-center text-base font-semibold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
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

        {/* Merk (officials) + Totaal Strafpunten */}
        <div>
          <h2 className="text-2xl font-bold mb-2 text-gray-800">Merk</h2>
          <p className="mb-4 text-base text-gray-700">
            Additional scoring by officials. 6 rows.
          </p>
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-orange-100">
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-bold text-gray-800 w-10">
                    NR
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-bold text-gray-800">
                    MERK
                  </th>
                  <th className="py-2 px-2 border-b border-gray-300 text-xs font-bold text-gray-800">
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
                    <td className="py-1.5 px-2 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 text-center">
                      <input
                        type="text"
                        className="w-full min-w-[8rem] h-10 p-1 border border-gray-400 rounded text-base focus:border-orange-500 focus:ring-1 focus:ring-orange-200 text-gray-700"
                        value={row.merk}
                        onChange={(e) => handleMerkChange(rowIndex, 'merk', e.target.value)}
                        aria-label={`Merk for row ${row.rowNumber}`}
                      />
                    </td>
                    <td className="py-1.5 px-1 border-b border-gray-300 text-center">
                      <input
                        type="number"
                        min={0}
                        className="w-16 h-10 p-1 border border-gray-400 rounded text-center text-base font-semibold focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-gray-700"
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
          <div className="mt-6 border-2 border-gray-800 rounded-lg overflow-hidden shadow-md">
            <div className="bg-gray-800 text-white py-2 px-4 text-center font-bold text-lg tracking-wide">
              TOTAAL STRAFPUNTEN
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
