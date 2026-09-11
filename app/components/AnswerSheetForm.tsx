import React, { useState, useEffect, useMemo, useRef } from 'react';
import ClassificationBadge from './ClassificationBadge';
import { crewLabel, type ClassificationValue } from '../lib/participants';
import {
  answerVariants,
  calculateMerkPenalty,
  calculateRowPenalty,
  calculateTotalPenalty,
  hasOrderError,
  PENALTY_PER_ERROR,
  type MerkKeyRow,
  type ScoreKeyRow,
} from '../lib/scoring';
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
  // The route (leg) this stage is ridden in, on a rally that has routes. The
  // time chain needs it: the delta is neutralised at a route boundary, so a
  // stage that opens a leg starts from zero however far off the crew were at the
  // end of the previous one. Null on a rally with no routes.
  routeId?: string | null;
  // The ORC key of the stage. It is read in full here: the strafpunten of a row
  // are *scored*, never typed, so the grid grades every row against the key
  // while the official types it — with the same module the server stores the
  // total with, so what is on screen is what gets saved. The key also marks the
  // rows whose letters are scored on their order, so the official knows to type
  // them exactly as the participant wrote them.
  scoreKey?: ScoreKeyRow[];
  timeScoreKey?: TimeKeyRow[];
  timeConfig?: Partial<StageTimeConfig>;
  // The merk key, unlike the ORC key, *is* read here: the merk column is scored
  // from the sheet alone (it does not chain across stages), so the card can show
  // the official what the column costs while they type it — the same module the
  // server scores it with.
  merkScoreKey?: MerkKeyRow[];
  // Whether this stage's ORC rows run 1-60 and its merk rows 1-12 instead of
  // the usual 1-30/1-6 — a crew ran out of rows mid-stage and switched to a
  // second paper card. The time module is unaffected either way. See "Second
  // answer card" in CLAUDE.md.
  usesSecondCard?: boolean;
}

// A sheet this participant already has for another stage of the same rally. The
// time penalty of a stage depends on the delta carried out of the earlier ones,
// so the live preview needs them.
interface ExistingSheet {
  eq: number;
  stageId: string;
  timePenalties?: { rowNumber: number; wpt?: string }[];
}

// The crew recorded for an EQ number of this rally, so the official typing a
// card can see whose card they are typing.
interface ParticipantDetails {
  eq: number;
  classification?: ClassificationValue;
  driverName?: string;
  navigatorName?: string;
}

// Only the letters of a row are typed; its strafpunten are scored against the
// stage's ORC key, exactly as the time and merk columns are.
interface AnswerRow {
  rowNumber: number;
  selectedAnswers: string[];
}

// Only the WPT is typed on a sheet; the ideal time, the +/- and the penalty of
// a row are computed from the stage's time key.
interface TimePenaltyRow {
  rowNumber: number;
  wpt: string;
}

// Only the letter is typed on a merk row; the penalty is scored from the
// stage's merk key.
interface MerkRow {
  rowNumber: number;
  merk: string;
}

// An existing sheet being corrected. Rows are keyed by their row number, so a
// stored sheet with fewer rows than the card still fills the right ones.
export interface AnswerSheetInitialData {
  eq: number;
  stageId: string;
  answers?: { rowNumber: number; selectedAnswers?: string[]; strafp?: number }[];
  timePenalties?: { rowNumber: number; wpt?: string }[];
  merkScores?: { rowNumber: number; merk?: string; strafp?: number }[];
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
    merkScores: { rowNumber: number; merk: string }[];
  }) => void;
  stages: Stage[];
  // Every sheet already entered for this rally; used to carry the participant's
  // time delta into the stage being typed.
  sheets?: ExistingSheet[];
  // The entry list of this rally: the crews a card can be typed for. A sheet
  // belongs to a crew, so this is the list the official picks from — an EQ the
  // rally has no participant for cannot be entered (the API refuses it too).
  participants?: ParticipantDetails[];
  // Set when an already submitted sheet is being corrected: the card starts
  // filled in and the stage it belongs to is fixed (a sheet is identified by
  // {stage, eq}, so moving it to another stage is a delete plus a new sheet).
  initialData?: AnswerSheetInitialData;
  isEditing?: boolean;
  // Set when the stage and the EQ were already picked in a step before this
  // form was shown (the answer-sheets wizard): the two selects are replaced
  // with a plain summary of what was picked, and `onChangeSelection` is the
  // link back to that step. Ignored while editing — a submitted sheet keeps
  // its own selects (the stage fixed, the EQ still open to renumbering).
  lockSelection?: boolean;
  onChangeSelection?: () => void;
}

// Layout constants matching the SARK controlekaart. ANSWER_ROWS/MERK_ROWS are
// one physical card's worth; a stage with `usesSecondCard` doubles both (see
// `answerRowCount`/`merkRowCount` below) — the time module never doubles, so
// TIME_ROWS stays a plain constant.
const ANSWER_ROWS = 30; // ORC's letters (was 40)
const LETTER_COLUMNS = 4;
const TIME_ROWS = 10; // IPT / WPT / +/- / strafp
const MERK_ROWS = 6; // Merk letters, scored vertically against the stage key

// Grid identifiers used for keyboard navigation between cells. Each visible
// table is its own grid so arrow keys stay within the column the user is
// looking at. Only the typed cells count: the strafpunten of a row are
// computed, so the ORC grids end at the last letter column. Their *sizes*
// depend on the selected stage (`gridDims`, inside the component) rather than
// being a module constant, because a `usesSecondCard` stage has more rows.
type GridName = 'orc-left' | 'orc-right' | 'time' | 'merk';

// Fill a fixed-size grid of `rows` rows from whatever the stored sheet has, by
// row number, leaving the rest blank.
const fillRows = <T,>(
  count: number,
  blank: (rowNumber: number) => T,
  stored: { rowNumber: number }[] | undefined,
  merge: (row: T, storedRow: any) => T
): T[] =>
  Array.from({ length: count }, (_, index) => {
    const rowNumber = index + 1;
    const row = blank(rowNumber);
    const storedRow = stored?.find((candidate) => candidate.rowNumber === rowNumber);
    return storedRow ? merge(row, storedRow) : row;
  });

const AnswerSheetForm: React.FC<AnswerSheetFormProps> = ({
  onSubmit,
  stages,
  sheets = [],
  participants = [],
  initialData,
  isEditing = false,
  lockSelection = false,
  onChangeSelection,
}) => {
  const [eq, setEq] = useState<number | ''>(initialData?.eq ?? '');
  const [stageId, setStageId] = useState(initialData?.stageId || '');

  // The recorded crew of the EQ being typed, when there is one.
  const participantDetails = useMemo(
    () => (eq === '' ? undefined : participants.find((p) => p.eq === Number(eq))),
    [eq, participants]
  );

  // The entry list in EQ order — the order the officials read it in.
  const sortedParticipants = useMemo(
    () => [...participants].sort((a, b) => a.eq - b.eq),
    [participants]
  );

  // The crews that already have a sheet for the stage being typed. A stage holds
  // one sheet per participant, so those cannot be entered a second time: the
  // time import opens a card as soon as a control hands its times in, and the
  // letters belong on that sheet — typing a new one would either be refused by
  // the API or, worse, replace a card that already carries a WPT. The sheet
  // being corrected is not in the way of itself.
  const takenEqs = useMemo(() => {
    if (!stageId) return new Set<number>();
    return new Set(
      sheets
        .filter((sheet) => sheet.stageId === stageId)
        .filter((sheet) => !(isEditing && sheet.eq === initialData?.eq))
        .map((sheet) => sheet.eq)
    );
  }, [sheets, stageId, isEditing, initialData]);

  // A sheet typed before this rally had an entry list can carry an EQ that is
  // not on it. It stays selectable on that sheet — a card already scored has to
  // remain correctable — but it is the only way to reach one.
  const unlistedEq = useMemo(() => {
    if (eq === '') return null;
    return sortedParticipants.some((p) => p.eq === Number(eq)) ? null : Number(eq);
  }, [eq, sortedParticipants]);

  const eqTaken = eq !== '' && takenEqs.has(Number(eq));
  const noEntryList = sortedParticipants.length === 0;

  // The stage the card is being typed for, and how many ORC/merk rows it
  // actually has — doubled from the base card size on a `usesSecondCard`
  // stage. Falls back to the base size before a stage is selected, so the
  // card starts at the normal 30/6 rather than an empty grid.
  const selectedStage = stages.find((candidate) => candidate._id === stageId);
  const answerRowCount = selectedStage?.usesSecondCard ? ANSWER_ROWS * 2 : ANSWER_ROWS;
  const merkRowCount = selectedStage?.usesSecondCard ? MERK_ROWS * 2 : MERK_ROWS;
  const orcHalf = Math.ceil(answerRowCount / 2); // rows per ORC column

  // Dimensions of each keyboard-navigation grid, sized from the stage above —
  // a plain object recomputed each render (cheap, and `focusCell`/
  // `handleCellKeyDown` below only ever read it inside an event handler, well
  // after this render has finished, so there is nothing to memoize against).
  const gridDims: Record<GridName, { rows: number; cols: number }> = {
    'orc-left': { rows: orcHalf, cols: LETTER_COLUMNS }, // letters only — the strafp. is scored
    'orc-right': { rows: answerRowCount - orcHalf, cols: LETTER_COLUMNS },
    time: { rows: TIME_ROWS, cols: 1 }, // wpt only — the rest is computed
    merk: { rows: merkRowCount, cols: 1 }, // merk letter only — the rest is computed
  };

  const formRef = useRef<HTMLFormElement>(null);

  // Move focus to a specific cell, identified by grid + row + column, and
  // select its contents so a new value overwrites the old one. `rowStep` keeps
  // vertical movement going over cells that cannot take focus — the WPT of a
  // time row the stage does not use as a checkpoint is disabled.
  const focusCell = (grid: GridName, row: number, col: number, rowStep = 0) => {
    const dims = gridDims[grid];
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
    if (!grid || !gridDims[grid] || Number.isNaN(row) || Number.isNaN(col)) return;

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
        // Tab / Shift+Tab move down / up a row and back to the first column, so
        // a card is typed row by row: finish a row wherever you are in it, Tab,
        // and you start the next one. The time and merk grids have one column
        // anyway. At the grid edge let the browser move focus out of the grid
        // as usual.
        const step = e.shiftKey ? -1 : 1;
        const nextRow = row + step;
        if (nextRow >= 0 && nextRow < gridDims[grid].rows) {
          if (focusCell(grid, nextRow, 0, step)) e.preventDefault();
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

  const [answers, setAnswers] = useState<AnswerRow[]>(() =>
    fillRows<AnswerRow>(
      answerRowCount,
      (rowNumber) => ({
        rowNumber,
        selectedAnswers: Array(LETTER_COLUMNS).fill(''),
      }),
      initialData?.answers,
      (row, stored) => ({
        ...row,
        selectedAnswers: Array.from(
          { length: LETTER_COLUMNS },
          (_, colIndex) => stored.selectedAnswers?.[colIndex] || ''
        ),
      })
    )
  );

  const [timePenalties, setTimePenalties] = useState<TimePenaltyRow[]>(() =>
    fillRows<TimePenaltyRow>(
      TIME_ROWS,
      (rowNumber) => ({ rowNumber, wpt: '' }),
      initialData?.timePenalties,
      (row, stored) => ({ ...row, wpt: stored.wpt || '' })
    )
  );

  const [merkScores, setMerkScores] = useState<MerkRow[]>(() =>
    fillRows<MerkRow>(
      merkRowCount,
      (rowNumber) => ({ rowNumber, merk: '' }),
      initialData?.merkScores,
      (row, stored) => ({ ...row, merk: stored.merk || '' })
    )
  );

  // `answers`/`merkScores` above are sized once, at mount. Picking a
  // different stage after that (only possible while adding a new sheet — the
  // select is disabled while editing one) has to resize them to match,
  // because a `usesSecondCard` stage has more rows than a normal one. This
  // also re-seeds them from `initialData` right after mount, which is a
  // harmless repeat of what the initializers above already computed.
  useEffect(() => {
    setAnswers(
      fillRows<AnswerRow>(
        answerRowCount,
        (rowNumber) => ({ rowNumber, selectedAnswers: Array(LETTER_COLUMNS).fill('') }),
        initialData?.answers,
        (row, stored) => ({
          ...row,
          selectedAnswers: Array.from(
            { length: LETTER_COLUMNS },
            (_, colIndex) => stored.selectedAnswers?.[colIndex] || ''
          ),
        })
      )
    );
    setMerkScores(
      fillRows<MerkRow>(
        merkRowCount,
        (rowNumber) => ({ rowNumber, merk: '' }),
        initialData?.merkScores,
        (row, stored) => ({ ...row, merk: stored.merk || '' })
      )
    );
    // Deliberately `[stageId]` only. `answerRowCount`/`merkRowCount` and
    // `initialData` are not stage-change signals of their own: `initialData`
    // is stable for the life of an edit (the stage select is disabled then),
    // and including the row counts would fire this effect — wiping out
    // whatever the official has typed — on any render where the `stages`
    // prop is a new array reference with the same content, not only on an
    // actual stage change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

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

  const handleWptChange = (rowIndex: number, value: string) => {
    setTimePenalties((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], wpt: value };
      return next;
    });
  };

  const handleMerkChange = (rowIndex: number, value: string) => {
    setMerkScores((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], merk: value.toUpperCase() };
      return next;
    });
  };

  // Live time scoring for the sheet being typed. The stage is scored in the
  // context of the whole rally: the delta this participant carries out of the
  // earlier stages of the same route is where this stage starts — a stage that
  // opens a route starts from zero — and the finish of the last stage of the
  // last route disqualifies instead of costing points. Same module the server
  // scores with, so what the official sees here is what gets stored.
  //
  // `stages` therefore has to arrive in running order, grouped by route, which
  // is what GET /api/stages returns.
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
        routeId: stage.routeId || null,
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
        missing: false,
        disqualified: false,
        free: false,
      }));

  // Live merk scoring for the sheet being typed. The merk column is scored on
  // its own — it does not chain across stages the way the time does — so the
  // whole result can be shown while the official types it, from the same module
  // the server scores it with.
  const merkResult = useMemo(() => {
    const stage = stages.find((candidate) => candidate._id === stageId);
    return calculateMerkPenalty(stage?.merkScoreKey, merkScores);
  }, [stages, stageId, merkScores]);

  // The scored rows by row number: the result also covers key rows the sheet
  // has no letter on, so the grid cannot read them off by index.
  const merkRowByNumber = useMemo(
    () => new Map(merkResult.rows.map((row) => [row.rowNumber, row])),
    [merkResult]
  );

  // Live ORC scoring for the sheet being typed. Like the merk column, the ORC
  // rows are scored from the sheet and the stage key alone — they do not chain
  // across stages the way the time does — so every row can be graded while the
  // official types it, with the same module the server stores the total with.
  // The strafpunten are therefore shown, never entered: a row costs what the
  // key says it costs.
  const orcKey = useMemo(() => {
    const stage = stages.find((candidate) => candidate._id === stageId);
    return stage?.scoreKey || [];
  }, [stages, stageId]);

  const orcKeyByRow = useMemo(
    () => new Map(orcKey.map((row) => [row.rowNumber, row])),
    [orcKey]
  );

  // The scored state of every row of the card: what it costs, and whether the
  // key asks for an order and the letters are out of it. A row the key does not
  // cover — a stage that uses fewer than 30 ORC's — costs nothing.
  const orcRowScores = useMemo(() => {
    const scores = new Map<
      number,
      { strafp: number; orderMatters: boolean; orderError: boolean }
    >();

    answers.forEach((row) => {
      const keyRow = orcKeyByRow.get(row.rowNumber);
      if (!keyRow) {
        scores.set(row.rowNumber, { strafp: 0, orderMatters: false, orderError: false });
        return;
      }
      const participantRow = {
        rowNumber: row.rowNumber,
        selectedAnswers: row.selectedAnswers,
      };
      scores.set(row.rowNumber, {
        strafp: calculateRowPenalty(keyRow, participantRow),
        orderMatters: Boolean(keyRow.orderMatters),
        orderError: hasOrderError(keyRow, participantRow),
      });
    });

    return scores;
  }, [answers, orcKeyByRow]);

  // A stage whose key has no letters at all scores every card 0 on the ORC's;
  // saying so beats a column of zeroes nobody can explain.
  const orcKeyEmpty = useMemo(
    () => !orcKey.some((row) => answerVariants(row).some((variant) => variant.length > 0)),
    [orcKey]
  );

  // Penalty totals for the "Totaal Strafpunten" overview. The ORC total comes
  // from the key rather than from the rows on screen, exactly as the server
  // computes it — a key row the card has no row for still costs its letters.
  const orcTotal = useMemo(() => calculateTotalPenalty(orcKey, answers), [orcKey, answers]);
  const tijdTotal = timeResult ? timeResult.totalPenalty : 0;
  const diversenTotal = merkResult.totalPenalty;
  const grandTotal = orcTotal + tijdTotal + diversenTotal;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate the participant
    if (eq === '' || isNaN(Number(eq)) || Number(eq) < 1 || Number(eq) > 100) {
      alert('Please select a participant');
      return;
    }

    // Validate stage selection
    if (!stageId) {
      alert('Please select a stage');
      return;
    }

    // The API refuses both of these as well; catching them here keeps a whole
    // typed card from being thrown away on submit.
    if (unlistedEq !== null && !isEditing) {
      alert(`EQ ${unlistedEq} is not a participant of this rally. Import the entry list first.`);
      return;
    }

    if (eqTaken) {
      alert(
        `EQ ${eq} already has an answer sheet for this stage. ` +
          'Open that sheet to correct it.'
      );
      return;
    }

    const processedAnswers = answers.map((row) => ({
      rowNumber: row.rowNumber,
      selectedAnswers: row.selectedAnswers.filter((answer) => answer.trim() !== ''),
      // Sent so the request carries the card as it was shown; the server
      // scores the rows itself (see app/lib/validation.ts).
      strafp: orcRowScores.get(row.rowNumber)?.strafp || 0,
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

    // Only the letters are sent; the server scores the column against the merk
    // key, exactly as the preview above does.
    const processedMerkScores = merkScores.map((row) => ({
      rowNumber: row.rowNumber,
      merk: row.merk.trim().toUpperCase(),
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
  //
  // Only the letters are inputs: the strafpunten cell shows what the row costs
  // against the stage key and follows every letter typed into the row.
  const renderAnswerRow = (
    row: AnswerRow,
    rowIndex: number,
    grid: GridName,
    localRow: number
  ) => {
    const scored = orcRowScores.get(row.rowNumber);

    return (
      <tr
        key={row.rowNumber}
        className={
          scored?.strafp ? 'bg-red-50' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'
        }
      >
        <td className="py-0.5 px-1 border-b border-r border-gray-300 font-bold text-sm text-gray-800 text-center w-7">
          {row.rowNumber}
          {scored?.orderMatters && (
            <span
              className={`block text-[9px] font-bold leading-tight ${
                scored.orderError ? 'text-red-700' : 'text-purple-700'
              }`}
              title={
                scored.orderError
                  ? `The letters of this row are out of the order of the key (+${PENALTY_PER_ERROR})`
                  : 'Volgorde telt — type the letters in the order the participant wrote them'
              }
            >
              1&rarr;2
            </span>
          )}
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
        <td
          className={`py-0.5 px-1 border-b border-gray-300 text-center text-sm font-bold ${
            scored?.strafp ? 'text-red-700' : 'text-gray-900'
          }`}
          title={
            scored?.orderError
              ? `Scored against the stage key, including ${PENALTY_PER_ERROR} for the wrong order`
              : 'Scored against the stage key'
          }
        >
          {scored?.strafp || 0}
        </td>
      </tr>
    );
  };

  // ORC section split into two even columns, like the paper card — 15/15 on
  // a normal stage, 30/30 once the second card doubles it to 60 rows.
  const half = orcHalf;
  const leftRows = answers.slice(0, half);
  const rightRows = answers.slice(half);
  const columnRange = (rows: AnswerRow[]) =>
    rows.length === 0 ? '' : `${rows[0].rowNumber}–${rows[rows.length - 1].rowNumber}`;

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
        {lockSelection && !isEditing ? (
          <>
            {/* The stage and the EQ were already picked in the steps before
                this card — shown here as a fixed summary rather than editable
                selects, with a way back to that step. */}
            <div className="sm:w-56">
              <span className="block text-sm font-semibold mb-1 text-gray-800">Stage</span>
              <div className="p-2 border-2 border-gray-200 rounded-lg bg-gray-50 text-base font-semibold text-gray-800 truncate">
                {stages.find((stage) => stage._id === stageId)?.name || '—'}
              </div>
            </div>
            <div className="sm:w-40">
              <span className="block text-sm font-semibold mb-1 text-gray-800">EQ. No.</span>
              <div className="p-2 border-2 border-gray-200 rounded-lg bg-gray-50 text-base font-semibold text-gray-800">
                {eq}
              </div>
            </div>
            {onChangeSelection && (
              <button
                type="button"
                onClick={onChangeSelection}
                className="text-sm font-medium text-blue-600 hover:underline sm:pb-2.5"
              >
                &larr; Change participant
              </button>
            )}
          </>
        ) : (
          <>
            {/* Only crews on the entry list can be typed a card, and only one
                per stage — the numbers that already have a sheet are shown but
                cannot be picked. */}
            <div className="sm:w-72">
              <label htmlFor="eq" className="block text-sm font-semibold mb-1 text-gray-800">
                EQ. No. — Participant
              </label>
              <select
                id="eq"
                className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700 disabled:bg-gray-100"
                value={eq}
                onChange={(e) => setEq(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={noEntryList && unlistedEq === null}
                required
              >
                <option value="">Select a participant</option>
                {unlistedEq !== null && (
                  <option value={unlistedEq}>{unlistedEq} &mdash; not on the entry list</option>
                )}
                {sortedParticipants.map((participant) => {
                  const taken = takenEqs.has(participant.eq);
                  const name = crewLabel(participant);
                  return (
                    <option key={participant.eq} value={participant.eq} disabled={taken}>
                      {participant.eq}
                      {name ? ` — ${name}` : ''}
                      {taken ? ' (already entered)' : ''}
                    </option>
                  );
                })}
              </select>
              {noEntryList && (
                <p className="mt-1 text-sm text-red-700">
                  This rally has no entry list yet. Import it before typing cards.
                </p>
              )}
              {eqTaken && (
                <p className="mt-1 text-sm text-red-700">
                  EQ {eq} already has a sheet for this stage &mdash; open that sheet to add the
                  letters.
                </p>
              )}
            </div>
            <div className="sm:w-72">
              <label htmlFor="stageId" className="block text-sm font-semibold mb-1 text-gray-800">
                Select Stage (Controlekaart)
              </label>
              <select
                id="stageId"
                className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700 disabled:bg-gray-100"
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                disabled={isEditing}
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
          </>
        )}
        {/* Who this EQ number is, so a mistyped number is caught before the
            whole card has been entered. */}
        <div className="sm:pb-2">
          <span className="block text-sm font-semibold mb-1 text-gray-800">Participant</span>
          {eq === '' ? (
            <span className="text-sm text-gray-600">Select a participant.</span>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-base text-gray-800">
              <ClassificationBadge classification={participantDetails?.classification} />
              {participantDetails ? (
                crewLabel(participantDetails) || <span className="text-gray-500">no names</span>
              ) : (
                <span className="text-gray-500">no details for EQ {eq}</span>
              )}
            </span>
          )}
        </div>

        <p className="text-sm text-gray-600 sm:ml-auto sm:pb-2">
          {isEditing
            ? 'Correct the card and save. The strafpunten follow the letters you type — the stage of a submitted sheet cannot be changed, delete it and enter a new one instead.'
            : 'Type one letter per column, as the participant wrote them. The strafpunten are scored against the stage answer key while you type.'}
        </p>
      </div>

      {/* Score card laid out as 4 main columns, like the SARK controlekaart:
          ORC's 1-15 | ORC's 16-30 | For Official Use Only (time) | Merk + totals */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4 items-start">
        {/* Column 1 — ORC's rows 1-15 */}
        <div>
          <h2 className="text-sm font-bold mb-1 text-gray-800">
            ORC&apos;s ({columnRange(leftRows)})
          </h2>
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
          <h2 className="text-sm font-bold mb-1 text-gray-800">
            ORC&apos;s ({columnRange(rightRows)})
          </h2>
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              {answerHeader}
              <tbody>
                {rightRows.map((row, i) => renderAnswerRow(row, row.rowNumber - 1, 'orc-right', i))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-gray-600 mt-1">
            {orcKeyEmpty
              ? 'This stage has no ORC answer key yet, so every row scores 0. Add the key to the stage and the cards are re-scored.'
              : `Each wrong, missing or doubled letter costs ${PENALTY_PER_ERROR}, and so does the wrong order on a row marked 1→2, up to the row's maximum.`}
          </p>
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
                      row.outOfWindow || row.missing
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
                        row.outOfWindow || row.missing ? 'text-red-700' : 'text-gray-900'
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
            since the previous control. The start of the first stage of every route is free — the
            delta is neutralised at a route boundary and starts again from zero there; a control
            passed outside its window costs the maximum and the delta reverts to the last valid
            one, and a control the stage uses but that has no WPT was missed and costs its maximum
            too.
            {eq === '' && ' Select a participant to see their own times.'}
          </p>
          {timeResult?.disqualified && (
            <p className="mt-1 px-2 py-1 rounded bg-red-100 text-red-800 text-xs font-bold">
              No finish time, or outside the finish window, on the last stage of the last route —
              this participant is disqualified.
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
          <h2 className="text-sm font-bold mb-1 text-gray-800">
            Merk{merkRowCount > MERK_ROWS ? ` (1–${merkRowCount})` : ''}
          </h2>
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
                {merkScores.map((row, rowIndex) => {
                  const scored = merkRowByNumber.get(row.rowNumber);
                  return (
                    <tr
                      key={row.rowNumber}
                      className={
                        scored?.status === 'double' ||
                        scored?.status === 'false' ||
                        scored?.status === 'missing'
                          ? 'bg-red-50'
                          : rowIndex % 2 === 0
                            ? 'bg-white'
                            : 'bg-gray-50'
                      }
                    >
                      <td className="py-0.5 px-1 border-b border-r border-gray-300 font-bold text-sm text-gray-800 text-center">
                        {row.rowNumber}
                      </td>
                      <td className="py-0.5 px-0.5 border-b border-r border-gray-300 text-center">
                        <input
                          type="text"
                          maxLength={1}
                          className="w-10 h-8 p-0.5 border border-gray-400 rounded text-center text-sm font-bold uppercase focus:border-orange-500 focus:ring-1 focus:ring-orange-200 text-gray-700"
                          value={row.merk}
                          data-grid="merk"
                          data-row={rowIndex}
                          data-col={0}
                          onKeyDown={handleCellKeyDown}
                          onChange={(e) => handleMerkChange(rowIndex, e.target.value)}
                          aria-label={`Merk letter for row ${row.rowNumber}`}
                        />
                        {scored?.status === 'false' && (
                          <span
                            className="ml-1 text-[10px] font-semibold text-red-700"
                            title="A letter this stage's merk key rules out"
                          >
                            fout
                          </span>
                        )}
                        {scored?.status === 'missing' && (
                          <span
                            className="ml-1 text-[10px] font-semibold text-red-700"
                            title="A letter of this stage's merk key the column never got"
                          >
                            {scored.missingMerk} ontbreekt
                          </span>
                        )}
                        {scored?.status === 'ignored' && (
                          <span
                            className="ml-1 text-[10px] text-gray-500"
                            title="In neither list of this stage's merk key — it never costs points"
                          >
                            not in key
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-0.5 px-0.5 border-b border-gray-300 text-center text-sm font-bold ${
                          scored?.strafp ? 'text-red-700' : 'text-gray-900'
                        }`}
                      >
                        {scored?.strafp || 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* The merk check is vertical: the column as a whole is compared with
              the key. A missing letter belongs to no row of its own, so it is
              charged to an empty one — the key row asking for it when it is
              free — and the column adds up to what it costs. */}
          <div className="mt-1 text-[11px] leading-tight text-gray-700 space-y-0.5">
            <p>
              <span className="font-semibold">Key:</span>{' '}
              {merkResult.keyLetters.length > 0 ? merkResult.keyLetters.join(' ') : '—'}
              {merkResult.keyLetters.length > 0 && (
                <span className="text-gray-500"> · any row, any order</span>
              )}
            </p>
            {merkResult.falseLetters.length > 0 && (
              <p>
                <span className="font-semibold">Fout:</span>{' '}
                <span className="text-red-700 font-bold">
                  {merkResult.falseLetters.join(' ')}
                </span>
                <span className="text-gray-500"> · {PENALTY_PER_ERROR} each, any row</span>
              </p>
            )}
            {merkResult.missing.length > 0 && (
              <p className="text-red-700 font-semibold">
                Missing: {merkResult.missing.join(' ')} —{' '}
                {merkResult.missing.length * PENALTY_PER_ERROR}
              </p>
            )}
            {merkResult.doubled.length > 0 && (
              <p className="text-red-700 font-semibold">
                Doubled: {merkResult.doubled.join(' ')} —{' '}
                {merkResult.doubled.length * PENALTY_PER_ERROR}
              </p>
            )}
            {merkResult.falseGiven.length > 0 && (
              <p className="text-red-700 font-semibold">
                False: {merkResult.falseGiven.join(' ')} —{' '}
                {merkResult.falseGiven.length * PENALTY_PER_ERROR}
              </p>
            )}
            {(merkResult.keyLetters.length > 0 || merkResult.falseLetters.length > 0) &&
              merkResult.missing.length === 0 &&
              merkResult.doubled.length === 0 &&
              merkResult.falseGiven.length === 0 && (
                <p className="text-green-700 font-semibold">Column complete — no merk penalty.</p>
              )}
            {merkResult.capped && (
              <p className="text-gray-600">Capped at the stage maximum of {merkResult.maxPenalty}.</p>
            )}
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
            className={`mt-3 w-full px-6 py-2.5 text-white rounded-lg font-bold text-base shadow-lg transition duration-150 ${
              isEditing ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {isEditing ? 'Save Changes' : 'Submit Answer Sheet'}
          </button>
        </div>
      </div>
    </form>
  );
};

export default AnswerSheetForm;
