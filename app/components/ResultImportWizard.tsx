'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ClassificationBadge from './ClassificationBadge';
import { columnLetters } from '../lib/columnMapping';
import { readSpreadsheet, SpreadsheetError } from '../lib/spreadsheet';
import {
  buildResultRows,
  EMPTY_RESULT_COLUMN_MAP,
  findResultHeaderRow,
  guessResultColumns,
  RESULT_FIELDS,
  toResultPayload,
  type ResultColumnMap,
  type ResultField,
  type ResultRow,
} from '../lib/resultImport';
import { STATUS_LABEL } from '../lib/standings';
import type { Rally } from '../types';

interface ResultImportWizardProps {
  // Pre-selected from a link, so an official who came from a rally does not
  // have to find it again.
  initialRallyId?: string;
}

interface ImportSummary {
  total: number;
  finishers: number;
  ridersCreated: number;
  classificationsFilled: number;
}

function formatDate(value?: string): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Importing the **result** of a rally the club rode before this system
// existed: a finishing order, the two riders in each car and their classes.
//
// Two steps on one screen: pick the rally, then the file and what its columns
// mean. The mapping is guessed from the header names but stays editable,
// because these sheets were written for whoever kept the results at the time.
//
// The file is read in the browser, like every other import here; only the
// mapped values are sent. What arrives is a finishing order and a set of
// riders — no strafpunten, because there are none: those rallies were scored
// on paper. That is exactly what the overall standings need, since a season is
// ranked on positions rather than on points.
const ResultImportWizard: React.FC<ResultImportWizardProps> = ({ initialRallyId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rallies, setRallies] = useState<Rally[]>([]);
  const [rallyId, setRallyId] = useState<string>(initialRallyId ?? '');
  const [loadingRallies, setLoadingRallies] = useState(true);

  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<ResultColumnMap>(EMPTY_RESULT_COLUMN_MAP);

  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/rallies');
        if (!response.ok) throw new Error('Failed to fetch rallies');
        setRallies(await response.json());
      } catch (err) {
        setError('Could not load the rallies.');
        console.error(err);
      } finally {
        setLoadingRallies(false);
      }
    };

    void load();
  }, []);

  const rally = rallies.find((entry) => entry._id === rallyId) ?? null;
  const header = sheet[headerRow] || [];

  const rows: ResultRow[] = useMemo(
    () => (sheet.length === 0 ? [] : buildResultRows(sheet, headerRow, columns)),
    [sheet, headerRow, columns]
  );

  const usable = rows.filter((row) => row.error === null);
  const failed = rows.filter((row) => row.error !== null);
  const warned = usable.filter((row) => row.warning !== null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    setReading(true);
    setError(null);
    setSummary(null);
    try {
      const grid = await readSpreadsheet(file);
      if (grid.length === 0) throw new SpreadsheetError('This file has no rows.');

      const detected = findResultHeaderRow(grid);
      setSheet(grid);
      setHeaderRow(detected);
      setColumns(guessResultColumns(grid[detected] || []));
      setFileName(file.name);
    } catch (err) {
      setSheet([]);
      setFileName('');
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

  const handleImport = async () => {
    const payload = toResultPayload(rows);
    if (payload.length === 0 || !rallyId) return;

    if (
      !window.confirm(
        `Import ${payload.length} result${payload.length === 1 ? '' : 's'} into "${
          rally?.name ?? 'this rally'
        }"?\n\n` +
          'This replaces the whole entry list of that rally and marks it as a rally whose ' +
          'results were imported — it can no longer be given stages or answer sheets.'
      )
    ) {
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const response = await fetch(`/api/rallies/${rallyId}/results/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: payload }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to import the results');

      setSummary({
        total: data.total ?? payload.length,
        finishers: data.finishers ?? 0,
        ridersCreated: data.ridersCreated ?? 0,
        classificationsFilled: data.classificationsFilled ?? 0,
      });
      setSheet([]);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import the results.');
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  const setColumn = (field: ResultField, value: number) =>
    setColumns((current) => ({ ...current, [field]: value }));

  // "C — bNaam", so a column can be recognised both by its letter and by
  // whatever the sheet calls it.
  const columnLabel = (index: number): string => {
    const name = (header[index] || '').trim();
    return name ? `${columnLetters(index)} — ${name}` : columnLetters(index);
  };

  const columnCount = Math.max(header.length, ...sheet.map((row) => row.length), 0);

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded text-base font-medium">
          {error}
        </div>
      )}

      {summary && (
        <div className="bg-green-50 border border-green-300 text-green-900 px-4 py-3 rounded text-base">
          <p className="font-semibold">
            Imported {summary.total} result{summary.total === 1 ? '' : 's'} into{' '}
            {rally?.name ?? 'the rally'} — {summary.finishers} finisher
            {summary.finishers === 1 ? '' : 's'}.
          </p>
          <p className="mt-1">
            {summary.ridersCreated > 0
              ? `${summary.ridersCreated} new member${
                  summary.ridersCreated === 1 ? '' : 's'
                } added to the register`
              : 'Every member was already in the register'}
            {summary.classificationsFilled > 0 &&
              `, ${summary.classificationsFilled} of them given a class from the sheet`}
            .
          </p>
          <p className="mt-2">
            <Link href="/standings/overall" className="text-green-800 underline font-medium">
              See the overall standings
            </Link>
          </p>
        </div>
      )}

      {/* --- Step 1: which rally ------------------------------------------ */}
      <section className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">1. Which rally</h2>
        <p className="text-gray-600 text-base mb-3 max-w-3xl">
          The rally these results belong to. It has to be one that was{' '}
          <strong>not scored in this system</strong> — a rally with stages or answer sheets
          already has a result, and two of them would disagree. Create the rally first (with
          its date and time factor) if it is not in the list.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={rallyId}
            onChange={(e) => {
              setRallyId(e.target.value);
              setSummary(null);
            }}
            aria-label="Rally"
            disabled={loadingRallies}
            className="p-2 border-2 border-gray-300 rounded-lg text-base text-gray-700 min-w-[22rem]"
          >
            <option value="">{loadingRallies ? 'Loading…' : '— pick a rally —'}</option>
            {rallies.map((entry) => (
              <option key={entry._id} value={entry._id}>
                {entry.name}
                {entry.date ? ` — ${formatDate(entry.date)}` : ''}
                {entry.resultsImported ? ' (results imported)' : ''}
                {entry.countsForSeason === false ? ' (unofficial)' : ''}
              </option>
            ))}
          </select>

          <Link
            href="/rallies/new"
            className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-base"
          >
            Create a rally
          </Link>
        </div>

        {rally && (
          <p className="text-gray-600 text-base mt-3">
            Ridden {formatDate(rally.date ?? rally.createdAt)} · time factor{' '}
            <span className="font-semibold">×{rally.timeFactor ?? 1}</span>
            {rally.countsForSeason === false && ' · does not count towards the season'}
            {rally.resultsImported &&
              ' · already has imported results, which this will replace'}
          </p>
        )}
      </section>

      {/* --- Step 2: the file --------------------------------------------- */}
      <section className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">2. The results file</h2>
        <p className="text-gray-600 text-base mb-3 max-w-3xl">
          An .xlsx or .csv with one line per crew: the finish position, and the name, e-mail
          address and class of the driver and the navigator. The file is read here in the
          browser — only the mapped values are sent. If the sheet also carries the crew&apos;s
          own EQ (equipe) number, map that column too — otherwise the EQ is assigned as a row
          number in finish order, which can disagree with the number the crew actually carried.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            disabled={!rallyId}
            className="block text-base text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium hover:file:bg-blue-700 disabled:opacity-60"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {!rallyId && <span className="text-base text-gray-500">Pick a rally first.</span>}
          {reading && (
            <span className="text-base text-gray-600">Reading {fileName || 'file'}…</span>
          )}
          {!reading && fileName && (
            <span className="text-base text-gray-600">
              {sheet.length} line{sheet.length === 1 ? '' : 's'} read from {fileName}
            </span>
          )}
        </div>
      </section>

      {sheet.length > 0 && (
        <>
          {/* Column mapping. Guessed from the header, but these sheets were
              written for whoever kept the results at the time, so the official
              gets the final say. */}
          <section className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">3. What the columns are</h2>

            <div className="mb-4">
              <label
                htmlFor="result-header-row"
                className="block text-sm font-semibold mb-1 text-gray-800"
              >
                Header row
              </label>
              <select
                id="result-header-row"
                className="p-2 border-2 border-gray-300 rounded-lg text-base text-gray-700"
                value={headerRow}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setHeaderRow(next);
                  setColumns(guessResultColumns(sheet[next] || []));
                }}
              >
                {sheet.slice(0, 20).map((row, index) => (
                  <option key={index} value={index}>
                    Line {index + 1}: {row.slice(0, 6).filter(Boolean).join(' | ').slice(0, 70)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {RESULT_FIELDS.map(({ field, label, required }) => (
                <div key={field}>
                  <label
                    htmlFor={`result-${field}`}
                    className="block text-sm font-semibold mb-1 text-gray-800"
                  >
                    {label} {required && <span className="text-red-600">*</span>}
                  </label>
                  <select
                    id={`result-${field}`}
                    className="w-full p-2 border-2 border-gray-300 rounded-lg text-base text-gray-700"
                    value={columns[field]}
                    onChange={(e) => setColumn(field, Number(e.target.value))}
                  >
                    <option value={-1}>— none —</option>
                    {Array.from({ length: columnCount }, (_, index) => (
                      <option key={index} value={index}>
                        {columnLabel(index)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>

          {/* --- Preview --------------------------------------------------- */}
          <section className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">4. What will be saved</h2>

            <div className="flex flex-wrap gap-4 mb-3 items-center">
              <span className="text-base font-semibold text-gray-800">
                {usable.length} result{usable.length === 1 ? '' : 's'} to import
              </span>
              {warned.length > 0 && (
                <span className="text-base text-amber-700">
                  {warned.length} with a crew class that disagrees with its members
                </span>
              )}
              {failed.length > 0 && (
                <span className="text-base font-semibold text-red-700">
                  {failed.length} row{failed.length === 1 ? '' : 's'} will be skipped
                </span>
              )}
            </div>

            <div className="max-h-96 overflow-auto border-2 border-gray-200 rounded-lg mb-4">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    {['Line', 'EQ', 'Pos', 'Driver', 'Navigator', 'Crew class', 'Status'].map(
                      (heading) => (
                        <th
                          key={heading}
                          className="px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase"
                        >
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.map((row) => (
                    <tr
                      key={row.lineNumber}
                      className={row.error ? 'bg-red-50' : row.warning ? 'bg-amber-50' : ''}
                    >
                      <td className="px-4 py-2 text-base text-gray-500">{row.lineNumber}</td>
                      <td className="px-4 py-2 text-base text-gray-700">
                        {row.eq ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-2 text-base font-bold text-gray-900">
                        {row.status === 'finished' ? (
                          row.position
                        ) : (
                          <span className="text-red-700">{STATUS_LABEL[row.status]}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-base text-gray-800">
                        {row.driverName || <span className="text-gray-400">—</span>}
                        <span className="block text-sm text-gray-500">
                          {row.driverEmail}
                          {row.driverClassification && ` · ${row.driverClassification}`}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-base text-gray-800">
                        {row.navigatorName || <span className="text-gray-400">—</span>}
                        <span className="block text-sm text-gray-500">
                          {row.navigatorEmail}
                          {row.navigatorClassification && ` · ${row.navigatorClassification}`}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {/* The crew class is derived from the two riders, never
                            taken from the sheet — the column is only a check. */}
                        <ClassificationBadge classification={row.derivedCrewClassification} />
                      </td>
                      <td className="px-4 py-2 text-base">
                        {row.error ? (
                          <span className="text-red-700 font-medium">{row.error}</span>
                        ) : row.warning ? (
                          <span className="text-amber-700">{row.warning}</span>
                        ) : (
                          <span className="text-green-700">Ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded text-base mb-4">
              <span className="font-semibold">Importing replaces this rally&apos;s entry
              list</span>{' '}
              and marks it as a rally whose results were imported: it can no longer be given
              stages or answer sheets. Members the register does not have are created from
              their e-mail address, and a member with no class yet is given the one on the
              sheet — a member who already has a class keeps it.
            </div>

            <button
              onClick={handleImport}
              disabled={importing || usable.length === 0 || !rallyId}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-base shadow-sm disabled:opacity-60"
            >
              {importing
                ? 'Importing…'
                : `Import ${usable.length} result${usable.length === 1 ? '' : 's'}`}
            </button>
          </section>
        </>
      )}
    </div>
  );
};

export default ResultImportWizard;
