'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { columnLetters } from '../lib/columnMapping';
import { crewLabel } from '../lib/participants';
import { readSpreadsheet, SpreadsheetError } from '../lib/spreadsheet';
import {
  buildTimeImportRows,
  controlValues,
  EMPTY_TIME_COLUMN_MAP,
  findTimeHeaderRow,
  guessTimeColumns,
  TIME_IMPORT_FIELDS,
  toTimePayload,
  type TimeColumnMap,
  type TimeImportField,
  type TimeImportRow,
} from '../lib/timeImport';
import { parseClock, TIME_ROWS, timeRowKind, timeRowLabel } from '../lib/timeScoring';
import type { Participant, Rally, Stage } from '../types';
import type { RallyRoute } from '../lib/routes';

// Importing the times of one control into the time column of a stage.
//
// A GTC does not hand in a card: it hands in its own export, one line per
// participant number, of which only the crews that actually passed carry a
// time. Typing 60 of those by hand is where the evening goes, so the file is
// mapped onto one row of the controlekaart instead.
//
// Four steps, because the file itself says nothing about where it belongs:
// which rally, which stage, which of the ten time rows, and only then the file
// and its columns. The rally has to have its entry list first — a time is
// imported for a crew, and a line of the export for an EQ this rally has not
// entered is ignored rather than turned into a new participant.
//
// The file is read in the browser (app/lib/spreadsheet.ts); only `{eq, wpt}`
// per crew is sent. Everything the time is worth — the +/-, the penalty of the
// row, the delta carried into the next stage — is computed server-side, exactly
// as it is when an official types the time on the card.

// Where the wizard reads a rally from and writes the times to. The default is
// the server; the offline workspace (app/offline) passes one backed by the copy
// of the rally in the browser (app/lib/offline/store.ts `applyTimeImport`),
// which applies the same rules and answers in the same shape.
export interface TimeImportSource {
  loadRallies: () => Promise<Rally[]>;
  loadRally: (
    rallyId: string
  ) => Promise<{ stages: Stage[]; participants: Participant[]; routes: RallyRoute[] }>;
  // The EQ's that already have a sheet for the stage.
  loadStageSheetEqs: (stageId: string) => Promise<number[]>;
  importTimes: (
    stageId: string,
    body: { rowNumber: number; times: { eq: number; wpt: string }[]; createMissingSheets: boolean }
  ) => Promise<{
    total?: number;
    updated?: number;
    created?: number;
    skipped?: number;
    ignored?: number;
  }>;
  // No links to the online pages of the rally: the workspace has its own.
  offline?: boolean;
}

const serverSource: TimeImportSource = {
  loadRallies: async () => {
    const response = await fetch('/api/rallies');
    if (!response.ok) throw new Error('Failed to fetch rallies');
    return response.json();
  },
  loadRally: async (rallyId) => {
    const [stagesRes, participantsRes, routesRes] = await Promise.all([
      fetch(`/api/stages?rallyId=${rallyId}`),
      fetch(`/api/rallies/${rallyId}/participants`),
      fetch(`/api/rallies/${rallyId}/routes`),
    ]);
    if (!stagesRes.ok) throw new Error('Failed to fetch stages');
    if (!participantsRes.ok) throw new Error('Failed to fetch participants');

    return {
      stages: await stagesRes.json(),
      participants: await participantsRes.json(),
      routes: routesRes.ok ? (await routesRes.json()).routes || [] : [],
    };
  },
  loadStageSheetEqs: async (stageId) => {
    const response = await fetch(`/api/answersheets?stageId=${stageId}`);
    if (!response.ok) throw new Error('Failed to fetch answer sheets');
    const data = await response.json();
    return data.map((entry: { eq: number }) => entry.eq);
  },
  importTimes: async (stageId, body) => {
    const response = await fetch(`/api/stages/${stageId}/times/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Failed to import the times');
    return data;
  },
};

interface TimeImportWizardProps {
  // Pre-selected when the wizard is opened from a rally or a stage.
  initialRallyId?: string;
  initialStageId?: string;
  source?: TimeImportSource;
}

interface ImportResult {
  total: number;
  updated: number;
  created: number;
  skipped: number;
  ignored: number;
  rowLabel: string;
  stageName: string;
}

const stepClass = (enabled: boolean) =>
  `bg-white rounded-lg shadow-lg p-6 mb-6 ${enabled ? '' : 'opacity-60'}`;

const TimeImportWizard: React.FC<TimeImportWizardProps> = ({
  initialRallyId,
  initialStageId,
  source = serverSource,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rallies, setRallies] = useState<Rally[]>([]);
  const [rallyId, setRallyId] = useState<string>(initialRallyId || '');
  const [stages, setStages] = useState<Stage[]>([]);
  // The rally's legs. Empty on a rally with no routes, and then the stage list
  // is the flat one it always was.
  const [routes, setRoutes] = useState<RallyRoute[]>([]);
  const [stageId, setStageId] = useState<string>(initialStageId || '');
  const [rowNumber, setRowNumber] = useState<number>(2);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sheetEqs, setSheetEqs] = useState<number[]>([]);
  const [loadingRally, setLoadingRally] = useState(false);
  const [loadingStage, setLoadingStage] = useState(false);

  const [fileName, setFileName] = useState<string>('');
  const [sheet, setSheet] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState<number>(0);
  const [columns, setColumns] = useState<TimeColumnMap>(EMPTY_TIME_COLUMN_MAP);
  const [controlValue, setControlValue] = useState<string>('');
  const [createMissingSheets, setCreateMissingSheets] = useState(true);
  const [hideSkipped, setHideSkipped] = useState(true);

  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  // --- the rally, its stages and who rides in it --------------------------

  useEffect(() => {
    const loadRallies = async () => {
      try {
        setRallies(await source.loadRallies());
      } catch (err) {
        setError('Failed to load the rallies.');
        console.error(err);
      }
    };
    loadRallies();
  }, [source]);

  useEffect(() => {
    if (!rallyId) {
      setStages([]);
      setParticipants([]);
      setRoutes([]);
      return;
    }

    const loadRally = async () => {
      setLoadingRally(true);
      try {
        const loaded = await source.loadRally(rallyId);
        setStages(loaded.stages);
        setParticipants(loaded.participants);
        setRoutes(loaded.routes);
        setError(null);
      } catch (err) {
        setStages([]);
        setParticipants([]);
        setRoutes([]);
        setError('Failed to load this rally. Please try again.');
        console.error(err);
      } finally {
        setLoadingRally(false);
      }
    };
    loadRally();
  }, [rallyId, source]);

  // Which participants already have a sheet for this stage decides whether a
  // line updates a card or writes a new one.
  const loadSheets = useCallback(async () => {
    if (!stageId) {
      setSheetEqs([]);
      return;
    }
    setLoadingStage(true);
    try {
      setSheetEqs(await source.loadStageSheetEqs(stageId));
    } catch (err) {
      setSheetEqs([]);
      setError('Failed to load the answer sheets of this stage.');
      console.error(err);
    } finally {
      setLoadingStage(false);
    }
  }, [stageId, source]);

  useEffect(() => {
    loadSheets();
  }, [loadSheets]);

  const stage = stages.find((candidate) => candidate._id === stageId);
  const participantEqs = useMemo(
    () => new Set(participants.map((participant) => participant.eq)),
    [participants]
  );
  const sheetEqSet = useMemo(() => new Set(sheetEqs), [sheetEqs]);
  const crewByEq = useMemo(
    () => new Map(participants.map((participant) => [participant.eq, participant])),
    [participants]
  );

  // The IPT 0 of a row is what makes it a checkpoint of this stage.
  const iptOf = (row: number): string => {
    const key = (stage?.timeScoreKey || []).find((entry) => entry.rowNumber === row);
    return key && parseClock(key.ipt) !== null ? key.ipt : '';
  };

  const selectedRowHasIpt = Boolean(stage) && iptOf(rowNumber) !== '';

  // --- the file -----------------------------------------------------------

  const resetFile = () => {
    setSheet([]);
    setFileName('');
    setColumns(EMPTY_TIME_COLUMN_MAP);
    setControlValue('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    setReading(true);
    setError(null);
    setResult(null);
    try {
      const grid = await readSpreadsheet(file);
      if (grid.length === 0) throw new SpreadsheetError('This file has no rows.');

      const detected = findTimeHeaderRow(grid);
      setSheet(grid);
      setHeaderRow(detected);
      setColumns(guessTimeColumns(grid[detected] || []));
      setControlValue('');
      setFileName(file.name);
    } catch (err) {
      resetFile();
      setError(
        err instanceof SpreadsheetError
          ? err.message
          : 'This file could not be read. Save it as .xlsx or .csv and try again.'
      );
      console.error(err);
    } finally {
      setReading(false);
    }
  };

  const header = sheet[headerRow] || [];
  const columnCount = Math.max(header.length, ...sheet.map((row) => row.length), 0);

  // "C — mod-wpt", so a column can be recognised both by its letter and by
  // whatever the export calls it.
  const columnLabel = (index: number): string => {
    const name = (header[index] || '').trim();
    return name ? `${columnLetters(index)} — ${name}` : columnLetters(index);
  };

  const controls = useMemo(
    () => (sheet.length === 0 ? [] : controlValues(sheet, headerRow, columns)),
    [sheet, headerRow, columns]
  );

  const rows: TimeImportRow[] = useMemo(() => {
    if (sheet.length === 0 || !stage) return [];
    return buildTimeImportRows(sheet, headerRow, columns, {
      participantEqs,
      sheetEqs: sheetEqSet,
      createMissingSheets,
      controlValue,
    });
  }, [
    sheet,
    headerRow,
    columns,
    stage,
    participantEqs,
    sheetEqSet,
    createMissingSheets,
    controlValue,
  ]);

  const counts = useMemo(
    () => ({
      update: rows.filter((row) => row.outcome === 'update').length,
      create: rows.filter((row) => row.outcome === 'create').length,
      skip: rows.filter((row) => row.outcome === 'skip' && !row.notEntered).length,
      notEntered: rows.filter((row) => row.notEntered).length,
      error: rows.filter((row) => row.outcome === 'error').length,
    }),
    [rows]
  );

  const importable = counts.update + counts.create;
  const shownRows = hideSkipped ? rows.filter((row) => row.outcome !== 'skip') : rows;

  // A file that names one control while another one is selected is the mistake
  // this wizard is most likely to be asked to make.
  const controlMismatch = useMemo(() => {
    if (controls.length !== 1 || timeRowKind(rowNumber) !== 'gtc') return null;
    const digits = controls[0].match(/\d+/);
    if (!digits) return null;
    return Number(digits[0]) === rowNumber - 1 ? null : controls[0];
  }, [controls, rowNumber]);

  // --- importing ----------------------------------------------------------

  const handleImport = async () => {
    const payload = toTimePayload(rows);
    if (!stage || payload.length === 0 || counts.error > 0) return;

    setImporting(true);
    setError(null);
    try {
      const data = await source.importTimes(stage._id, {
        rowNumber,
        times: payload,
        createMissingSheets,
      });

      setResult({
        total: data.total ?? payload.length,
        updated: data.updated ?? 0,
        created: data.created ?? 0,
        skipped: data.skipped ?? 0,
        ignored: counts.notEntered + (data.ignored ?? 0),
        rowLabel: timeRowLabel(rowNumber),
        stageName: stage.name,
      });
      resetFile();
      await loadSheets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import the times.');
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  const setColumn = (field: TimeImportField, value: number) =>
    setColumns((current) => ({ ...current, [field]: value }));

  const inputClass =
    'w-full p-3 border-2 border-gray-300 rounded-lg shadow-sm text-lg text-gray-800 focus:border-blue-500 focus:ring focus:ring-blue-200';

  return (
    <div>
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded mb-6 text-base font-medium">
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-green-100 border-l-4 border-green-500 text-green-800 px-4 py-3 rounded mb-6 text-base">
          <p className="font-semibold">
            {result.total} time{result.total === 1 ? '' : 's'} imported into {result.rowLabel} of{' '}
            {result.stageName} — {result.updated} sheet
            {result.updated === 1 ? '' : 's'} updated, {result.created} created.
            {result.skipped > 0 && ` ${result.skipped} skipped.`}
            {result.ignored > 0 &&
              ` ${result.ignored} line${result.ignored === 1 ? '' : 's'} for crews not in the entry list ignored.`}
          </p>
          {source.offline ? (
            <p className="mt-1">
              The standings in this workspace have been re-scored. The times are uploaded with
              the cards once there is a connection.
            </p>
          ) : (
            <p className="mt-1">
              The standings have been re-scored.{' '}
              <Link href={`/rallies/${rallyId}`} className="underline font-medium">
                Back to the rally
              </Link>
              {stage && (
                <>
                  {' · '}
                  <Link
                    href={`/rallies/${rallyId}/stages/${stage._id}`}
                    className="underline font-medium"
                  >
                    View the stage
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* Step 1 — the rally */}
      <div className={stepClass(true)}>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">1. Rally</h2>
        <p className="text-gray-600 text-base mb-3">
          The rally the control belongs to. Its participants have to be imported first — a time
          is only imported for a crew that is in the entry list, and a line of the file for any
          other EQ is ignored.
        </p>
        <select
          id="time-import-rally"
          className={inputClass}
          value={rallyId}
          onChange={(e) => {
            setRallyId(e.target.value);
            setStageId('');
            setResult(null);
            resetFile();
          }}
        >
          <option value="">— pick a rally —</option>
          {rallies.map((rally) => (
            <option key={rally._id} value={rally._id}>
              {rally.name}
            </option>
          ))}
        </select>

        {rallyId && !loadingRally && (
          <p className="mt-3 text-base text-gray-600">
            {participants.length === 0 ? (
              <span className="text-amber-700 font-medium">
                This rally has no participants yet.{' '}
                <Link href={`/rallies/${rallyId}`} className="underline">
                  Import its entry list first
                </Link>
                .
              </span>
            ) : (
              `${participants.length} participant${participants.length === 1 ? '' : 's'} in the entry list.`
            )}
          </p>
        )}
      </div>

      {/* Step 2 — the stage */}
      <div className={stepClass(Boolean(rallyId))}>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">2. Stage</h2>
        <p className="text-gray-600 text-base mb-3">
          The stage of the rally this control stands in, in running order
          {routes.length > 0 ? ', grouped by route' : ''}.
        </p>
        <select
          id="time-import-stage"
          className={inputClass}
          value={stageId}
          disabled={!rallyId || stages.length === 0}
          onChange={(e) => {
            setStageId(e.target.value);
            setResult(null);
          }}
        >
          <option value="">— pick a stage —</option>
          {/* Grouped under their route when the rally has them, and a flat
              running-order list when it does not. */}
          {routes.length > 0
            ? routes.map((route, routeIndex) => (
                <optgroup key={route._id} label={`${routeIndex + 1}. ${route.name}`}>
                  {stages
                    .filter((candidate) => (candidate.routeId || '') === route._id)
                    .map((candidate, index) => (
                      <option key={candidate._id} value={candidate._id}>
                        {index + 1}. {candidate.name}
                      </option>
                    ))}
                </optgroup>
              ))
            : stages.map((candidate, index) => (
                <option key={candidate._id} value={candidate._id}>
                  {index + 1}. {candidate.name}
                </option>
              ))}
        </select>

        {rallyId && !loadingRally && stages.length === 0 && (
          <p className="mt-3 text-base text-amber-700 font-medium">
            This rally has no stages yet.{' '}
            <Link href={`/rallies/${rallyId}/stages/new`} className="underline">
              Add one
            </Link>
            .
          </p>
        )}
      </div>

      {/* Step 3 — the control */}
      <div className={stepClass(Boolean(stage))}>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">3. Control</h2>
        <p className="text-gray-600 text-base mb-3">
          Which row of the time column these times belong on. A row shows its IPT 0 — the ideal
          passage time of participant 0; participant {'{eq}'} passes {'{eq}'} minutes later.
        </p>
        <select
          id="time-import-row"
          className={inputClass}
          value={rowNumber}
          disabled={!stage}
          onChange={(e) => setRowNumber(Number(e.target.value))}
        >
          {Array.from({ length: TIME_ROWS }, (unused, index) => {
            const row = index + 1;
            const ipt = iptOf(row);
            return (
              <option key={row} value={row}>
                {timeRowLabel(row)}
                {ipt ? ` — IPT 0 ${ipt}` : ' — not a checkpoint of this stage'}
              </option>
            );
          })}
        </select>

        {stage && !selectedRowHasIpt && (
          <p className="mt-3 text-base text-amber-700 font-medium">
            This row has no IPT 0 in the stage key, so the times will be stored but not scored.
            Add the ideal time on the{' '}
            <Link href={`/rallies/${rallyId}/stages/${stage._id}/edit`} className="underline">
              stage key
            </Link>{' '}
            to have them count.
          </p>
        )}
        {stage && !loadingStage && (
          <p className="mt-3 text-base text-gray-600">
            {sheetEqs.length} participant{sheetEqs.length === 1 ? '' : 's'} already have a sheet for
            this stage.
          </p>
        )}
      </div>

      {/* Step 4 — the file */}
      <div className={stepClass(Boolean(stage))}>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">4. The times</h2>
        <p className="text-gray-600 text-base mb-3">
          The export of the control, as .xlsx or .csv. It is read here in the browser — only the
          participant number and the time of each crew are sent. A line without a time is left
          alone: an import fills times in, it never clears them.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv"
          disabled={!stage}
          className="block text-base text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium hover:file:bg-blue-700 disabled:opacity-60"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {reading && (
          <p className="mt-2 text-base text-gray-600">Reading {fileName || 'file'}…</p>
        )}
        {!reading && fileName && (
          <p className="mt-2 text-base text-gray-600">
            {fileName} — {sheet.length} line{sheet.length === 1 ? '' : 's'} read
          </p>
        )}

        {sheet.length > 0 && stage && (
          <>
            {/* Column mapping. Guessed from the header, but these exports are
                not written for this app, so the official gets the final say. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
              {TIME_IMPORT_FIELDS.map(({ field, label, required, hint }) => (
                <div key={field}>
                  <label
                    htmlFor={`time-import-${field}`}
                    className="block text-sm font-semibold mb-1 text-gray-800"
                  >
                    {label} {required && <span className="text-red-600">*</span>}
                  </label>
                  <select
                    id={`time-import-${field}`}
                    className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
                    value={columns[field]}
                    onChange={(e) => {
                      setColumn(field, Number(e.target.value));
                      if (field === 'control') setControlValue('');
                    }}
                  >
                    <option value={-1}>— not in this file —</option>
                    {Array.from({ length: columnCount }, (unused, index) => (
                      <option key={index} value={index}>
                        {columnLabel(index)}
                      </option>
                    ))}
                  </select>
                  <p className="text-sm text-gray-500 mt-1">{hint}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-4">
              <label htmlFor="time-import-header-row" className="text-sm font-semibold text-gray-800">
                Header line
              </label>
              <select
                id="time-import-header-row"
                className="p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base text-gray-700"
                value={headerRow}
                onChange={(e) => {
                  const index = Number(e.target.value);
                  setHeaderRow(index);
                  setColumns(guessTimeColumns(sheet[index] || []));
                  setControlValue('');
                }}
              >
                {sheet.slice(0, 20).map((row, index) => (
                  <option key={index} value={index}>
                    Line {index + 1}:{' '}
                    {row.filter(Boolean).slice(0, 5).join(', ').slice(0, 60) || '(empty)'}
                  </option>
                ))}
              </select>

              {controls.length > 0 && (
                <>
                  <label
                    htmlFor="time-import-control-value"
                    className="text-sm font-semibold text-gray-800"
                  >
                    Only the lines of control
                  </label>
                  <select
                    id="time-import-control-value"
                    className="p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base text-gray-700"
                    value={controlValue}
                    onChange={(e) => setControlValue(e.target.value)}
                  >
                    <option value="">— every line —</option>
                    {controls.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            {controlMismatch && (
              <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 px-4 py-2 rounded mt-4 text-base font-medium">
                <p>
                  This file is for control {controlMismatch}, but the times are about to be
                  imported into {timeRowLabel(rowNumber)}. Check step 3 before you import.
                </p>
              </div>
            )}

            <label className="flex items-start gap-3 mt-4 text-base text-gray-800">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5"
                checked={createMissingSheets}
                onChange={(e) => setCreateMissingSheets(e.target.checked)}
              />
              <span>
                Create a sheet for a participant who has none for this stage yet. The sheet holds
                only this time — the ORC&apos;s are typed in later and score nothing until they
                are. Without this, those lines are skipped.
              </span>
            </label>

            {columns.eq < 0 || columns.wpt < 0 ? (
              <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 px-4 py-2 rounded mt-4 text-base font-medium">
                <p>Pick the participant column and the time column to see what will be imported.</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-4 mt-5 mb-3">
                  <span className="text-base font-semibold text-gray-800">
                    {importable} time{importable === 1 ? '' : 's'} to import
                  </span>
                  {counts.create > 0 && (
                    <span className="text-base text-gray-600">
                      {counts.create} on a new sheet
                    </span>
                  )}
                  {counts.skip > 0 && (
                    <span className="text-base text-gray-600">{counts.skip} line(s) skipped</span>
                  )}
                  {counts.notEntered > 0 && (
                    <span className="text-base text-gray-600">
                      {counts.notEntered} line(s) ignored — not in the entry list
                    </span>
                  )}
                  {counts.error > 0 && (
                    <span className="text-base font-semibold text-red-700">
                      {counts.error} line{counts.error === 1 ? '' : 's'} cannot be imported
                    </span>
                  )}
                  <label className="flex items-center gap-2 text-base text-gray-600 ml-auto">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={hideSkipped}
                      onChange={(e) => setHideSkipped(e.target.checked)}
                    />
                    Hide skipped lines
                  </label>
                </div>

                {counts.error > 0 && (
                  <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-2 rounded mb-3 text-base font-medium">
                    <p>
                      Nothing is imported while a line is wrong — a half-imported control is worse
                      than none. Correct the file or the column mapping and read it again.
                    </p>
                  </div>
                )}

                <div className="max-h-96 overflow-auto border-2 border-gray-200 rounded-lg bg-white mb-4">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        {['Line', 'EQ', 'Crew', 'Time', 'What happens'].map((label) => (
                          <th
                            key={label}
                            className="px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {shownRows.map((row) => (
                        <tr
                          key={row.lineNumber}
                          className={
                            row.outcome === 'error'
                              ? 'bg-red-50'
                              : row.outcome === 'skip'
                                ? 'bg-gray-50'
                                : ''
                          }
                        >
                          <td className="px-4 py-2 text-base text-gray-500">{row.lineNumber}</td>
                          <td className="px-4 py-2 text-base font-bold text-gray-900">
                            {row.eq ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-base text-gray-800">
                            {(row.eq !== null && crewLabel(crewByEq.get(row.eq))) || (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-base font-mono text-gray-900">
                            {row.wpt || <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-2 text-base">
                            {row.outcome === 'error' ? (
                              <span className="text-red-700 font-medium">{row.message}</span>
                            ) : row.outcome === 'create' ? (
                              <span className="text-green-700">{row.message}</span>
                            ) : row.outcome === 'update' ? (
                              <span className="text-blue-700">{row.message}</span>
                            ) : (
                              <span className="text-gray-500">{row.message}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {shownRows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-4 text-base text-gray-500">
                            Nothing to show — every line of this file is skipped.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleImport}
                    disabled={importing || importable === 0 || counts.error > 0}
                    className="px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-lg shadow-sm transition-colors disabled:opacity-60"
                  >
                    {importing
                      ? 'Importing…'
                      : `Import ${importable} time${importable === 1 ? '' : 's'} into ${timeRowLabel(rowNumber)}`}
                  </button>
                  <button
                    onClick={resetFile}
                    disabled={importing}
                    className="px-5 py-3 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-lg transition-colors disabled:opacity-60"
                  >
                    Pick another file
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TimeImportWizard;
