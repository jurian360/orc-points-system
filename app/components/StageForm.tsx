import React, { useState } from 'react';
import {
  DEFAULT_TIME_CONFIG,
  maxStageTimePenalty,
  resolveTimeConfig,
  timeRowLabel,
  timeRowKind,
  type StageTimeConfig,
} from '../lib/timeScoring';

interface ScoreKeyRow {
  rowNumber: number;
  answers: string[];
  falseAnswers?: { column: number; value: string }[];
  maxPenalty?: number;
  // "Volgorde": the correct letters of this row have to be given in the order
  // of the key. Only the ORC rows have an order — the time and merk columns
  // are single values, so they never carry this flag.
  orderMatters?: boolean;
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

interface StageFormProps {
  onSubmit: (
    stageName: string,
    scoreKey: ScoreKeyRow[],
    timeScoreKey: TimeScoreKeyRow[],
    merkScoreKey: MerkScoreKeyRow[],
    timeConfig: StageTimeConfig
  ) => void;
  initialData?: {
    name: string;
    scoreKey: ScoreKeyRow[];
    timeScoreKey?: TimeScoreKeyRow[];
    merkScoreKey?: MerkScoreKeyRow[];
    timeConfig?: Partial<StageTimeConfig>;
  };
  isEditing?: boolean;
  // The finish of the last stage of a rally disqualifies instead of costing the
  // maximum plus the break, which changes the maximum shown in the overview.
  isFinalStage?: boolean;
}

// Layout constants matching the SARK controlekaart
const ANSWER_ROWS = 30; // ORC's letters (was 40)
const LETTER_COLUMNS = 4;
const TIME_ROWS = 10; // IPT / WPT / +/- / strafp
const MERK_ROWS = 6; // Merk (officials)

const StageForm: React.FC<StageFormProps> = ({
  onSubmit,
  initialData,
  isEditing = false,
  isFinalStage = true,
}) => {
  const [stageName, setStageName] = useState(initialData?.name || '');

  const [scoreKey, setScoreKey] = useState<ScoreKeyRow[]>(() => {
    if (initialData?.scoreKey?.length) {
      return initialData.scoreKey;
    }
    return Array.from({ length: ANSWER_ROWS }, (_, index) => ({
      rowNumber: index + 1,
      answers: Array(LETTER_COLUMNS).fill(''),
      falseAnswers: [],
      maxPenalty: 0,
      orderMatters: false,
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

  const [timeConfig, setTimeConfig] = useState<StageTimeConfig>(() =>
    resolveTimeConfig(initialData?.timeConfig)
  );

  const handleTimeConfigChange = (field: keyof StageTimeConfig, value: string) => {
    const numValue = parseInt(value, 10);
    setTimeConfig((prev) => ({ ...prev, [field]: isNaN(numValue) ? 0 : Math.max(numValue, 0) }));
  };

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

  // Ticking "volgorde" on a row makes the order of its correct letters count:
  // giving them out of order costs one extra error (30 points) on top of the
  // letters themselves. See app/lib/scoring.ts.
  const handleOrderMattersChange = (rowIndex: number, checked: boolean) => {
    setScoreKey((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], orderMatters: checked };
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

  const handleTimeChange = (rowIndex: number, field: 'ipt', value: string) => {
    setTimeScoreKey((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [field]: value };
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
  const tijdTotal = maxStageTimePenalty(timeScoreKey, timeConfig, isFinalStage);
  const diversenTotal = merkScoreKey.reduce((sum, row) => sum + (row.maxPenalty || 0), 0);
  const grandTotal = orcTotal + tijdTotal + diversenTotal;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!stageName.trim()) {
      alert('Please enter a stage name');
      return;
    }

    const processedScoreKey = scoreKey.map((row) => ({
      rowNumber: row.rowNumber,
      answers: row.answers.filter((answer) => answer.trim() !== ''),
      falseAnswers: row.falseAnswers || [],
      maxPenalty: row.maxPenalty || 0,
      orderMatters: Boolean(row.orderMatters),
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

    onSubmit(
      stageName,
      processedScoreKey,
      processedTimeScoreKey,
      processedMerkScoreKey,
      timeConfig
    );
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
      <td className="py-2 px-2 border-b border-r border-gray-300 text-center">
        <input
          type="checkbox"
          className="w-5 h-5 accent-purple-600 cursor-pointer"
          checked={Boolean(row.orderMatters)}
          onChange={(e) => handleOrderMattersChange(rowIndex, e.target.checked)}
          aria-label={`The letters of row ${row.rowNumber} have to be in the order of the key`}
          title="Volgorde telt: the correct letters have to be given in the order of the key"
        />
      </td>
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
        <th
          className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800"
          title="Volgorde telt: the correct letters have to be given in the order of the key"
        >
          Volgorde
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
    <form onSubmit={handleSubmit} className="w-full mx-auto p-6">
      <div className="mb-8">
        <label htmlFor="stageName" className="block text-lg font-medium mb-2 text-gray-800">
          Stage Name
        </label>
        <input
          type="text"
          id="stageName"
          className="w-full p-3 border border-gray-300 rounded-md shadow-sm text-lg text-gray-800"
          value={stageName}
          onChange={(e) => setStageName(e.target.value)}
          placeholder="e.g. Stage 1 — Coastal leg"
          required
        />
      </div>

      {/* Answer key laid out as 4 main columns, like the SARK controlekaart:
          ORC's 1-15 | ORC's 16-30 | For Official Use Only (time) | Merk + totals */}
      <div className="mb-4">
        <p className="text-base text-gray-700">
          Enter the correct answer (green) and any explicit false answer (red) per column, plus the
          max penalty for each row.
        </p>
        <p className="text-sm text-gray-600 mt-1">
          Tick <span className="font-semibold">Volgorde</span> on an ORC row whose letters have to
          be given in the order of the key: the wrong order costs one extra error (30). A
          participant who gives only one of the letters pays for the missing ones and nothing more
          — a single letter cannot be out of order. The time and merk columns have no order.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8 items-start">
        {/* Column 1 — ORC's rows 1-15 */}
        <div>
          <h2 className="text-lg font-semibold mb-2 text-gray-800">ORC&apos;s (1&ndash;15)</h2>
          <div className="border border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              {scoreKeyHeader}
              <tbody>
                {leftRows.map((row) => renderScoreKeyRow(row, row.rowNumber - 1))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 2 — ORC's rows 16-30 */}
        <div>
          <h2 className="text-lg font-semibold mb-2 text-gray-800">ORC&apos;s (16&ndash;30)</h2>
          <div className="border border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              {scoreKeyHeader}
              <tbody>
                {rightRows.map((row) => renderScoreKeyRow(row, row.rowNumber - 1))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 3 — Tijd: the stage's timetable, written for participant 0 */}
        <div>
          <h2 className="text-lg font-semibold mb-2 text-gray-800">Tijd (IPT 0)</h2>
          <div className="border border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-yellow-100">
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800 w-10">
                    NR
                  </th>
                  <th className="py-2 px-2 border-b border-r border-gray-300 text-xs font-semibold text-gray-800">
                    CONTROLE
                  </th>
                  <th className="py-2 px-2 border-b border-gray-300 text-xs font-semibold text-gray-800">
                    IPT 0
                  </th>
                </tr>
              </thead>
              <tbody>
                {timeScoreKey.map((row, rowIndex) => {
                  const kind = timeRowKind(row.rowNumber);
                  return (
                    <tr
                      key={row.rowNumber}
                      className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                    >
                      <td className="py-2 px-2 border-b border-r border-gray-300 font-medium text-base text-gray-800 text-center">
                        {row.rowNumber}
                      </td>
                      <td
                        className={`py-2 px-2 border-b border-r border-gray-300 text-sm font-semibold ${
                          kind === 'gtc' ? 'text-gray-700' : 'text-blue-700'
                        }`}
                      >
                        {timeRowLabel(row.rowNumber)}
                      </td>
                      <td className="py-2 px-1 border-b border-gray-300 text-center">
                        <input
                          type="text"
                          className="w-24 h-10 p-1 border border-gray-300 rounded text-center text-base focus:border-yellow-500 focus:ring-1 focus:ring-yellow-200 text-gray-700"
                          value={row.ipt || ''}
                          onChange={(e) => handleTimeChange(rowIndex, 'ipt', e.target.value)}
                          placeholder="8:00"
                          aria-label={`IPT of participant 0 for ${timeRowLabel(row.rowNumber)}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-gray-600 mt-2">
            Enter the ideal passage time of participant 0 (e.g. 8:00). Every other participant
            starts a minute later, so participant 12 passes at 8:12. Leave a GTC row empty when the
            stage does not use it.
          </p>

          {/* Time-penalty settings of this stage */}
          <div className="mt-4 border border-gray-300 rounded-lg shadow-md overflow-hidden">
            <div className="bg-yellow-100 py-2 px-3 font-semibold text-sm text-gray-800">
              Tijdstraf instellingen
            </div>
            <div className="p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-gray-700">
                  GTC venster te vroeg (min)
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full h-10 p-1 border border-gray-300 rounded text-center text-base text-gray-700"
                    value={timeConfig.gtcEarlyWindow}
                    onChange={(e) => handleTimeConfigChange('gtcEarlyWindow', e.target.value)}
                  />
                </label>
                <label className="text-sm text-gray-700">
                  GTC venster te laat (min)
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full h-10 p-1 border border-gray-300 rounded text-center text-base text-gray-700"
                    value={timeConfig.gtcLateWindow}
                    onChange={(e) => handleTimeConfigChange('gtcLateWindow', e.target.value)}
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Finish venster te vroeg (min)
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full h-10 p-1 border border-gray-300 rounded text-center text-base text-gray-700"
                    value={timeConfig.finishEarlyWindow}
                    onChange={(e) => handleTimeConfigChange('finishEarlyWindow', e.target.value)}
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Finish venster te laat (min)
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full h-10 p-1 border border-gray-300 rounded text-center text-base text-gray-700"
                    value={timeConfig.finishLateWindow}
                    onChange={(e) => handleTimeConfigChange('finishLateWindow', e.target.value)}
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Max strafpunten buiten venster
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full h-10 p-1 border border-gray-300 rounded text-center text-base text-gray-700"
                    value={timeConfig.outOfWindowPenalty}
                    onChange={(e) => handleTimeConfigChange('outOfWindowPenalty', e.target.value)}
                  />
                </label>
                <label className="text-sm text-gray-700">
                  Pauze na deze etappe (min)
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full h-10 p-1 border border-gray-300 rounded text-center text-base text-gray-700"
                    value={timeConfig.breakMinutes}
                    onChange={(e) => handleTimeConfigChange('breakMinutes', e.target.value)}
                  />
                </label>
              </div>
              <p className="text-xs text-gray-600">
                A control passed outside its window costs the maximum ({timeConfig.outOfWindowPenalty}
                ) and the delta falls back to what it was before it. On the finish of a stage that is
                followed by another one the break is charged on top ({timeConfig.outOfWindowPenalty} +{' '}
                {timeConfig.breakMinutes} ={' '}
                {timeConfig.outOfWindowPenalty + timeConfig.breakMinutes}); on the finish of the last
                stage the same window means a disqualification. Defaults:{' '}
                {DEFAULT_TIME_CONFIG.gtcEarlyWindow}/{DEFAULT_TIME_CONFIG.gtcLateWindow} for a GTC,{' '}
                {DEFAULT_TIME_CONFIG.finishEarlyWindow}/{DEFAULT_TIME_CONFIG.finishLateWindow} for the
                finish.
              </p>
            </div>
          </div>
        </div>

        {/* Column 4 — Merk reference + Totaal overview */}
        <div>
          <h2 className="text-lg font-semibold mb-2 text-gray-800">Merk</h2>
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
          {isEditing ? 'Update Stage' : 'Save Stage'}
        </button>
      </div>
    </form>
  );
};

export default StageForm;
