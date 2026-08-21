import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  scoreRallyTimes,
  timeRowLabel,
  type ScoredTimeRow,
  type StageTimeConfig,
  type TimeEntryRow,
  type TimeKeyRow,
} from '../lib/timeScoring';

interface Stage {
  _id: string;
  name: string;
  timeScoreKey?: TimeKeyRow[];
  timeConfig?: Partial<StageTimeConfig>;
}

// A sheet this participant already has for another stage of the same rally. The
// time penalty of a stage depends on the delta carried out of the earlier ones,
// so the live preview needs them.
interface ExistingSheet {
  eq: number;
  stageId: string;
  timePenalties?: { rowNumber: number; wpt?: string }[];
}

interface AnswerRow {
  rowNumber: number;
  selectedAnswers: string[];
  strafp: string;
}

// Only the WPT is typed on a sheet; the ideal time, the +/- and the penalty of
// a row are computed from the stage's time key.
interface TimePenaltyRow {
  rowNumber: number;
  wpt: string;
}

interface MerkRow {
  rowNumber: number;
  merk: string;
  strafp: string;
}

interface AnswerSheetFormProps {
  onSubmit: (answerSheet: {
    eq: number;
    stageId: string;
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
  stages: Stage[];
  // Every sheet already entered for this rally; used to carry the participant's
  // time delta into the stage being typed.
  sheets?: ExistingSheet[];
}

// Layout constants matching the SARK controlekaart
const ANSWER_ROWS = 30; // ORC's letters (was 40)
const LETTER_COLUMNS = 4;
const TIME_ROWS = 10; // IPT / WPT / +/- / strafp
const MERK_ROWS = 6; // Merk (officials)

const ORC_HALF = Math.ceil(ANSWER_ROWS / 2); // rows per ORC column

// Grid identifiers + dimensions used for keyboard navigation between cells.
// Each visible table is its own grid so arrow keys stay within the column the
// user is looking at. Columns include the trailing strafpunten field.
type GridName = 'orc-left' | 'orc-right' | 'time' | 'merk';

const GRID_DIMS: Record<GridName, { rows: number; cols: number }> = {
  'orc-left': { rows: ORC_HALF, cols: LETTER_COLUMNS + 1 },
  'orc-right': { rows: ANSWER_ROWS - ORC_HALF, cols: LETTER_COLUMNS + 1 },
  time: { rows: TIME_ROWS, cols: 1 }, // wpt only — the rest is computed
  merk: { rows: MERK_ROWS, cols: 2 }, // merk, strafp
};

const toNumber = (value: string): number => {
  const n = parseInt(value, 10);
  return isNaN(n) ? 0 : n;
};

const AnswerSheetForm: React.FC<AnswerSheetFormProps> = ({ onSubmit, stages, sheets = [] }) => {
  const [eq, setEq] = useState<number | ''>('');
  const [stageId, setStageId] = useState('');

  const formRef = useRef<HTMLFormElement>(null);

  // Move focus to a specific cell, identified by grid + row + column, and
  // select its contents so a new value overwrites the old one. `rowStep` keeps
  // vertical movement going over cells that cannot take focus — the WPT of a
  // time row the stage does not use as a checkpoint is disabled.
  const focusCell = (grid: GridName, row: number, col: number, rowStep = 0) => {
    const dims = GRID_DIMS[grid];
    if (col < 0 || col >= dims.cols) return false;

    for (let r = row; r >= 0 && r < dims.rows; r += rowStep) {
      const el = formRef.current?.querySelector<HTMLInputElement>(
        `input[data-grid="${grid}"][data-row="${r}"][data-col="${col}"]`
      );
      if (el && !el.disabled) {
        el.focus();
        el.select();
        return true;
      }
      if (rowStep === 0) return false;
    }

    return false;
  };

  // Spreadsheet-style keyboard navigation shared by every cell.
  const handleCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const grid = el.dataset.grid as GridName | undefined;
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    if (!grid || !GRID_DIMS[grid] || Number.isNaN(row) || Number.isNaN(col)) return;

    // selectionStart is null for number inputs; treat those as always at an edge
    // so the arrow keys move between cells instead of nudging the number.
    const caret = el.selectionStart;
    const atStart = caret === null || (caret === 0 && el.selectionEnd === 0);
    const atEnd =
      caret === null || (caret === el.value.length && el.selectionEnd === el.value.length);

    switch (e.key) {
      case 'ArrowRight':
        if (atEnd) {
          e.preventDefault();
          focusCell(grid, row, col + 1);
        }
        break;
      case 'ArrowLeft':
        if (atStart) {
          e.preventDefault();
          focusCell(grid, row, col - 1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusCell(grid, row - 1, col, -1);
        break;
      case 'ArrowDown':
      case 'Enter':
        e.preventDefault();
        focusCell(grid, row + 1, col, 1);
        break;
      case 'Tab': {
        // Tab / Shift+Tab move down / up a row; at the grid edge let the browser
        // move focus out of the grid as usual.
        const step = e.shiftKey ? -1 : 1;
        const nextRow = row + step;
        if (nextRow >= 0 && nextRow < GRID_DIMS[grid].rows) {
          if (focusCell(grid, nextRow, col, step)) e.preventDefault();
        }
        break;
      }
    }
  };

  // After a letter is typed in an ORC answer cell, jump to the next letter
  // column (wrapping to the first column of the next row) for fast entry.
  const advanceAfterLetter = (grid: GridName, localRow: number, colIndex: number) => {
    if (colIndex < LETTER_COLUMNS - 1) {
      focusCell(grid, localRow, colIndex + 1);
    } else {
      focusCell(grid, localRow + 1, 0);
    }
  };

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
      wpt: '',
    }))
  );

  const [merkScores, setMerkScores] = useState<MerkRow[]>(
    Array.from({ length: MERK_ROWS }, (_, index) => ({
      rowNumber: index + 1,
      merk: '',
      strafp: '',
    }))
  );

  // Select the first stage by default once stages are loaded.
  useEffect(() => {
    if (stages.length > 0 && !stageId) {
      setStageId(stages[0]._id);
    }
  }, [stages, stageId]);

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

  const handleWptChange = (rowIndex: number, value: string) => {
    setTimePenalties((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], wpt: value };
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

  // Live time scoring for the sheet being typed. The stage is scored in the
  // context of the whole rally: the delta this participant carries out of the
  // earlier stages is where this stage starts, and the finish of the last stage
  // disqualifies instead of costing points. Same module the server scores with,
  // so what the official sees here is what gets stored.
  const timeResult = useMemo(() => {
    if (!stageId) return null;

    // Before an EQ is typed the card shows the timetable of participant 0.
    const participant = eq === '' ? 0 : Number(eq);

    const entriesByStage = new Map<string, TimeEntryRow[]>();
    sheets.forEach((sheet) => {
      if (sheet.eq === participant) {
        entriesByStage.set(sheet.stageId, sheet.timePenalties || []);
      }
    });
    // What is on screen wins over anything stored for this stage.
    entriesByStage.set(
      stageId,
      timePenalties.map((row) => ({ rowNumber: row.rowNumber, wpt: row.wpt }))
    );

    const results = scoreRallyTimes(
      stages.map((stage) => ({
        stageId: stage._id,
        timeScoreKey: stage.timeScoreKey,
        timeConfig: stage.timeConfig,
      })),
      participant,
      entriesByStage
    );

    return results.get(stageId) || null;
  }, [eq, stageId, stages, sheets, timePenalties]);

  const scoredTimeRows: ScoredTimeRow[] = timeResult
    ? timeResult.rows
    : timePenalties.map((row) => ({
        rowNumber: row.rowNumber,
        kind: 'gtc' as const,
        active: false,
        ipt: '',
        wpt: row.wpt,
        plusMinus: '',
        delta: null,
        strafp: 0,
        outOfWindow: false,
        disqualified: false,
        free: false,
      }));

  // Penalty totals for the "Totaal Strafpunten" overview
  const orcTotal = answers.reduce((sum, row) => sum + toNumber(row.strafp), 0);
  const tijdTotal = timeResult ? timeResult.totalPenalty : 0;
  const diversenTotal = merkScores.reduce((sum, row) => sum + toNumber(row.strafp), 0);
  const grandTotal = orcTotal + tijdTotal + diversenTotal;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate EQ
    if (eq === '' || isNaN(Number(eq)) || Number(eq) < 1 || Number(eq) > 100) {
      alert('Please enter a valid participant ID (1-100)');
      return;
    }

    // Validate stage selection
    if (!stageId) {
      alert('Please select a stage');
      return;
    }

    const processedAnswers = answers.map((row) => ({
      rowNumber: row.rowNumber,
      selectedAnswers: row.selectedAnswers.filter((answer) => answer.trim() !== ''),
      strafp: toNumber(row.strafp),
    }));

    // The server recomputes the derived cells from the stage's time key; they
    // are sent along so the request carries the card as it was shown.
    const processedTimePenalties = scoredTimeRows.map((row) => ({
      rowNumber: row.rowNumber,
      ipt: row.ipt,
      wpt: row.wpt.trim(),
      plusMinus: row.plusMinus,
      strafp: row.strafp,
    }));

    const processedMerkScores = merkScores.map((row) => ({
      rowNumber: row.rowNumber,
      merk: row.merk.trim(),
      strafp: toNumber(row.strafp),
    }));

    onSubmit({
      eq: Number(eq),
      stageId,
      answers: processedAnswers,
      timePenalties: processedTimePenalties,
      merkScores: processedMerkScores,
    });
  };

  // Render one ORC answer row (letters + strafp) — compact so the whole card fits on screen.
  // `grid`/`localRow` position the row for keyboard navigation; `rowIndex` is the
  // absolute index into the answers state array used when updating values.
  const renderAnswerRow = (
    row: AnswerRow,
    rowIndex: number,
    grid: GridName,
    localRow: number
  ) => (
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
            data-grid={grid}
            data-row={localRow}
            data-col={colIndex}
            onKeyDown={handleCellKeyDown}
            onChange={(e) => {
              handleAnswerChange(rowIndex, colIndex, e.target.value);
              if (e.target.value) advanceAfterLetter(grid, localRow, colIndex);
            }}
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
          data-grid={grid}
          data-row={localRow}
          data-col={LETTER_COLUMNS}
          onKeyDown={handleCellKeyDown}
          onChange={(e) => handleAnswerStrafpChange(rowIndex, e.target.value)}
          aria-label={`Strafpunten for row ${row.rowNumber}`}
        />
      </td>
    </tr>
  );

  // ORC section is split into two columns of 15 rows, like the paper card
  const half = ORC_HALF;
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
    <form ref={formRef} onSubmit={handleSubmit} className="w-full mx-auto">
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
          <label htmlFor="stageId" className="block text-sm font-semibold mb-1 text-gray-800">
            Select Stage (Controlekaart)
          </label>
          <select
            id="stageId"
            className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            required
          >
            <option value="">Select a stage</option>
            {stages.map((stage) => (
              <option key={stage._id} value={stage._id}>
                {stage.name}
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
                {leftRows.map((row, i) => renderAnswerRow(row, row.rowNumber - 1, 'orc-left', i))}
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
                {rightRows.map((row, i) => renderAnswerRow(row, row.rowNumber - 1, 'orc-right', i))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Column 3 — Tijd: officials type the WPT, the rest is scored live */}
        <div>
          <h2 className="text-sm font-bold mb-1 text-gray-800">Tijd</h2>
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-yellow-100">
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800 w-7">
                    NR
                  </th>
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800">
                    CONTROLE
                  </th>
                  <th className="py-1 px-1 border-b border-r border-gray-300 text-[10px] font-bold text-gray-800">
                    IPT
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
                {scoredTimeRows.map((row, rowIndex) => (
                  <tr
                    key={row.rowNumber}
                    className={
                      row.outOfWindow
                        ? 'bg-red-50'
                        : row.active
                          ? rowIndex % 2 === 0
                            ? 'bg-white'
                            : 'bg-gray-50'
                          : 'bg-gray-100'
                    }
                  >
                    <td className="py-0.5 px-1 border-b border-r border-gray-300 font-bold text-sm text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    <td
                      className={`py-0.5 px-1 border-b border-r border-gray-300 text-[11px] font-semibold ${
                        row.active ? 'text-gray-700' : 'text-gray-400'
                      }`}
                    >
                      {timeRowLabel(row.rowNumber)}
                      {row.free && <span className="font-normal text-gray-500"> (vrij)</span>}
                    </td>
                    <td className="py-0.5 px-1 border-b border-r border-gray-300 text-center text-sm text-gray-800">
                      {row.ipt || '-'}
                    </td>
                    <td className="py-0.5 px-0.5 border-b border-r border-gray-300 text-center">
                      <input
                        type="text"
                        className="w-16 h-8 p-0.5 border border-gray-400 rounded text-center text-sm focus:border-yellow-500 focus:ring-1 focus:ring-yellow-200 text-gray-700 disabled:bg-gray-100"
                        value={timePenalties[rowIndex]?.wpt || ''}
                        data-grid="time"
                        data-row={rowIndex}
                        data-col={0}
                        disabled={!row.active}
                        onKeyDown={handleCellKeyDown}
                        onChange={(e) => handleWptChange(rowIndex, e.target.value)}
                        placeholder={row.active ? '8:05' : ''}
                        aria-label={`WPT for ${timeRowLabel(row.rowNumber)}`}
                      />
                    </td>
                    <td className="py-0.5 px-1 border-b border-r border-gray-300 text-center text-sm font-semibold text-gray-800">
                      {row.plusMinus || '-'}
                    </td>
                    <td
                      className={`py-0.5 px-1 border-b border-gray-300 text-center text-sm font-bold ${
                        row.outOfWindow ? 'text-red-700' : 'text-gray-900'
                      }`}
                    >
                      {row.strafp}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-gray-600 mt-1">
            Type the WPT (e.g. 8:05). The IPT is this participant&apos;s ideal time — the stage&apos;s
            IPT 0 plus their EQ in minutes — and the strafpunten follow from how far the delta moved
            since the previous control. The start of the first stage is free; a control passed
            outside its window costs the maximum and the delta reverts to the last valid one.
            {eq === '' && ' Enter an EQ. No. to see this participant\u2019s own times.'}
          </p>
          {timeResult?.disqualified && (
            <p className="mt-1 px-2 py-1 rounded bg-red-100 text-red-800 text-xs font-bold">
              Outside the finish window of the last stage — this participant is disqualified.
            </p>
          )}
          {timeResult && (
            <p className="text-[11px] text-gray-600 mt-1">
              Delta into this stage: {timeResult.startDelta > 0 ? '+' : ''}
              {timeResult.startDelta} min &rarr; out of this stage:{' '}
              {timeResult.endDelta > 0 ? '+' : ''}
              {timeResult.endDelta} min
            </p>
          )}
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
                        data-grid="merk"
                        data-row={rowIndex}
                        data-col={0}
                        onKeyDown={handleCellKeyDown}
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
                        data-grid="merk"
                        data-row={rowIndex}
                        data-col={1}
                        onKeyDown={handleCellKeyDown}
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
            Submit Answer Sheet
          </button>
        </div>
      </div>
    </form>
  );
};

export default AnswerSheetForm;
