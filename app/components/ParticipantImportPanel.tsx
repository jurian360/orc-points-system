'use client';

import React, { useMemo, useRef, useState } from 'react';
import ClassificationBadge from './ClassificationBadge';
import { columnLetters } from '../lib/columnMapping';
import { readSpreadsheet, SpreadsheetError } from '../lib/spreadsheet';
import {
  buildImportRows,
  EMPTY_COLUMN_MAP,
  findHeaderRow,
  guessColumns,
  IMPORT_FIELDS,
  toPayload,
  type ColumnMap,
  type ImportField,
  type ImportRow,
} from '../lib/participantImport';

interface ParticipantImportPanelProps {
  rallyId: string;
  // The EQ numbers that already have a participant record, so the preview can
  // say which crews the import overwrites.
  existingEqs: number[];
  onImported: (summary: { total: number; created: number; updated: number }) => void;
  onCancel: () => void;
}

// Importing the entry list of a rally from the spreadsheet the organisation
// already keeps.
//
// Three steps on one screen: pick the file, confirm which column is which, then
// look at what will be saved. The mapping is guessed from the header names but
// stays editable, because these sheets are exported for the entry system rather
// than for this app — the one this was built against carries 28 columns, of
// which four are used.
//
// The file is read in the browser; only the four mapped values per crew are
// sent. Everything else in the sheet — e-mail addresses, phone numbers, dietary
// notes — never leaves the official's machine.
const ParticipantImportPanel: React.FC<ParticipantImportPanelProps> = ({
  rallyId,
  existingEqs,
  onImported,
  onCancel,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [sheet, setSheet] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState<number>(0);
  const [columns, setColumns] = useState<ColumnMap>(EMPTY_COLUMN_MAP);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = sheet[headerRow] || [];

  const rows: ImportRow[] = useMemo(
    () => (sheet.length === 0 ? [] : buildImportRows(sheet, headerRow, columns)),
    [sheet, headerRow, columns]
  );

  const usable = rows.filter((row) => row.error === null);
  const failed = rows.filter((row) => row.error !== null);
  const existing = new Set(existingEqs);
  const updates = usable.filter((row) => row.eq !== null && existing.has(row.eq)).length;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    setReading(true);
    setError(null);
    try {
      const grid = await readSpreadsheet(file);
      if (grid.length === 0) throw new SpreadsheetError('This file has no rows.');

      const detected = findHeaderRow(grid);
      setSheet(grid);
      setHeaderRow(detected);
      setColumns(guessColumns(grid[detected] || []));
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
    const payload = toPayload(rows);
    if (payload.length === 0) return;

    setImporting(true);
    setError(null);
    try {
      const response = await fetch(`/api/rallies/${rallyId}/participants/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants: payload }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to import participants');

      onImported({
        total: data.total ?? payload.length,
        created: data.created ?? 0,
        updated: data.updated ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import participants.');
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  const setColumn = (field: ImportField, value: number) =>
    setColumns((current) => ({ ...current, [field]: value }));

  // "C — EqKlasse", so a column can be recognised both by its letter and by
  // whatever the sheet calls it.
  const columnLabel = (index: number): string => {
    const name = (header[index] || '').trim();
    return name ? `${columnLetters(index)} — ${name}` : columnLetters(index);
  };

  const columnCount = Math.max(header.length, ...sheet.map((row) => row.length), 0);

  return (
    <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="max-w-3xl">
          <h3 className="text-base font-semibold text-gray-800">Import an entry list</h3>
          <p className="text-gray-600 text-base mt-1">
            Pick the .xlsx (or .csv) entry list of this rally. The file is read here in the
            browser — only the EQ number, the classification and the two names are saved.
            An EQ that already exists is updated.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-base"
        >
          Close
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-2 rounded mb-3 text-base font-medium">
          <p>{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv"
          className="block text-base text-gray-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium hover:file:bg-blue-700"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {reading && <span className="text-base text-gray-600">Reading {fileName || 'file'}…</span>}
        {!reading && fileName && (
          <span className="text-base text-gray-600">
            {sheet.length} line{sheet.length === 1 ? '' : 's'} read
          </span>
        )}
      </div>

      {sheet.length > 0 && (
        <>
          {/* Column mapping. Guessed from the header, but these sheets are not
              written for this app, so the official gets the final say. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            {IMPORT_FIELDS.map(({ field, label, required }) => (
              <div key={field}>
                <label
                  htmlFor={`import-${field}`}
                  className="block text-sm font-semibold mb-1 text-gray-800"
                >
                  {label} {required && <span className="text-red-600">*</span>}
                </label>
                <select
                  id={`import-${field}`}
                  className="w-full p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base focus:border-blue-500 focus:ring focus:ring-blue-200 text-gray-700"
                  value={columns[field]}
                  onChange={(e) => setColumn(field, Number(e.target.value))}
                >
                  <option value={-1}>— not in this sheet —</option>
                  {Array.from({ length: columnCount }, (_, index) => (
                    <option key={index} value={index}>
                      {columnLabel(index)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label htmlFor="import-header-row" className="text-sm font-semibold text-gray-800">
              Header row
            </label>
            <select
              id="import-header-row"
              className="p-2 border-2 border-gray-300 rounded-lg shadow-sm text-base text-gray-700"
              value={headerRow}
              onChange={(e) => {
                const index = Number(e.target.value);
                setHeaderRow(index);
                setColumns(guessColumns(sheet[index] || []));
              }}
            >
              {sheet.slice(0, 20).map((row, index) => (
                <option key={index} value={index}>
                  Line {index + 1}: {row.filter(Boolean).slice(0, 4).join(', ').slice(0, 60) || '(empty)'}
                </option>
              ))}
            </select>
            <span className="text-base text-gray-600">
              Everything below this line is read as a crew.
            </span>
          </div>

          {columns.eq < 0 ? (
            <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 px-4 py-2 rounded text-base font-medium">
              <p>Pick the column that holds the EQ number to see what will be imported.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-4 mb-3">
                <span className="text-base font-semibold text-gray-800">
                  {usable.length} participant{usable.length === 1 ? '' : 's'} to import
                </span>
                {updates > 0 && (
                  <span className="text-base text-gray-600">
                    {updates} of them already exist and will be updated
                  </span>
                )}
                {failed.length > 0 && (
                  <span className="text-base font-semibold text-red-700">
                    {failed.length} row{failed.length === 1 ? '' : 's'} will be skipped
                  </span>
                )}
              </div>

              <div className="max-h-96 overflow-auto border-2 border-gray-200 rounded-lg bg-white mb-4">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase">
                        Line
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase">
                        EQ
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase">
                        Class
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase">
                        Driver
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase">
                        Navigator
                      </th>
                      <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700 uppercase">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {rows.map((row) => (
                      <tr key={row.lineNumber} className={row.error ? 'bg-red-50' : ''}>
                        <td className="px-4 py-2 text-base text-gray-500">{row.lineNumber}</td>
                        <td className="px-4 py-2 text-base font-bold text-gray-900">
                          {row.eq ?? '—'}
                        </td>
                        <td className="px-4 py-2">
                          <ClassificationBadge classification={row.classification} />
                        </td>
                        <td className="px-4 py-2 text-base text-gray-800">
                          {row.driverName || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-2 text-base text-gray-800">
                          {row.navigatorName || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-2 text-base">
                          {row.error ? (
                            <span className="text-red-700 font-medium">{row.error}</span>
                          ) : row.eq !== null && existing.has(row.eq) ? (
                            <span className="text-amber-700">Updates existing</span>
                          ) : (
                            <span className="text-green-700">New</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleImport}
                  disabled={importing || usable.length === 0}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-base shadow-sm transition-colors disabled:opacity-60"
                >
                  {importing
                    ? 'Importing…'
                    : `Import ${usable.length} participant${usable.length === 1 ? '' : 's'}`}
                </button>
                <button
                  onClick={onCancel}
                  disabled={importing}
                  className="px-5 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 font-medium text-base transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default ParticipantImportPanel;
