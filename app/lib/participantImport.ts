// Turning a spreadsheet of an entry list into participants of a rally.
//
// The sheets officials get are not written for this app: the file this was
// built against ("DR2026-controle") carries 28 columns, of which four matter —
// the equipe number, its class, and the two names. So the columns are guessed
// by header name and then shown to the official to confirm or change, rather
// than being fixed by position.
//
// Every row is validated here before it is shown, with the same rules the API
// applies (app/lib/validation.ts). That is a preview, not a guard: the import
// route re-validates everything it is sent.

import { isClassification, type ClassificationValue } from './participants';

export const MAX_NAME_LENGTH = 200;

// The four fields an entry list has to supply. `eq` is the only required one —
// a crew without a class or without names is still a participant.
export type ImportField = 'eq' | 'classification' | 'driverName' | 'navigatorName';

export const IMPORT_FIELDS: { field: ImportField; label: string; required: boolean }[] = [
  { field: 'eq', label: 'EQ. No.', required: true },
  { field: 'classification', label: 'Classification', required: false },
  { field: 'driverName', label: 'Driver', required: false },
  { field: 'navigatorName', label: 'Navigator', required: false },
];

// Column index per field; -1 is "this sheet has no such column".
export type ColumnMap = Record<ImportField, number>;

export const EMPTY_COLUMN_MAP: ColumnMap = {
  eq: -1,
  classification: -1,
  driverName: -1,
  navigatorName: -1,
};

// Header names seen on rally entry lists, best match first. Dutch and English
// both appear; `b` is "bestuurder" (driver) and `n` is the navigator, which is
// how the exports from the entry system name their columns.
const HEADER_CANDIDATES: Record<ImportField, string[]> = {
  eq: ['equipe', 'eq', 'eqno', 'eqnr', 'eqnumber', 'nummer', 'number', 'startnummer', 'startno'],
  classification: ['eqklasse', 'klasse', 'classification', 'class', 'categorie', 'category'],
  driverName: ['bnaam', 'bestuurder', 'driver', 'drivername', 'chauffeur', 'rijder'],
  navigatorName: ['nnaam', 'navigator', 'navigatorname', 'nav', 'bijrijder'],
};

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

// Which row holds the headers. Entry lists sometimes carry a title or a blank
// line above them, so the sheet is scanned for the first row that names at
// least two of the four fields; failing that, the first non-empty row is used
// and the official remaps the columns by hand.
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 20);

  for (let index = 0; index < limit; index++) {
    const map = guessColumns(rows[index]);
    const matched = Object.values(map).filter((column) => column >= 0).length;
    if (map.eq >= 0 && matched >= 2) return index;
  }

  const firstFilled = rows.findIndex((row) => row.some((cell) => cell !== ''));
  return firstFilled < 0 ? 0 : firstFilled;
}

// Match the header cells against the known names. An exact match wins over a
// "contains" match, so a sheet with both "klasse" and "nklasse" (the navigator's
// own class) still maps the equipe class.
export function guessColumns(header: string[]): ColumnMap {
  const cells = header.map(normalize);
  const map: ColumnMap = { ...EMPTY_COLUMN_MAP };
  const taken = new Set<number>();

  for (const { field } of IMPORT_FIELDS) {
    const candidates = HEADER_CANDIDATES[field];

    const exact = cells.findIndex(
      (cell, index) => !taken.has(index) && candidates.includes(cell)
    );
    const index =
      exact >= 0
        ? exact
        : cells.findIndex(
            (cell, position) =>
              !taken.has(position) &&
              cell.length > 2 &&
              candidates.some((candidate) => candidate.length > 2 && cell.includes(candidate))
          );

    if (index >= 0) {
      map[field] = index;
      taken.add(index);
    }
  }

  return map;
}

// One participant as read from the sheet. `error` is set when the row cannot be
// imported; those rows are shown with their reason and left out of the import.
export interface ImportRow {
  // 1-based line number in the sheet, so a reported problem can be found back.
  lineNumber: number;
  eq: number | null;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  error: string | null;
}

const cellAt = (row: string[], column: number): string =>
  column >= 0 ? (row[column] ?? '').trim() : '';

// The sheet, read through the column map: one row per crew, in sheet order.
// Rows where every mapped cell is empty are dropped rather than reported — a
// trailing blank line is not a mistake worth showing.
export function buildImportRows(
  rows: string[][],
  headerRowIndex: number,
  map: ColumnMap
): ImportRow[] {
  const seen = new Map<number, number>();
  const imported: ImportRow[] = [];

  for (let index = headerRowIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const lineNumber = index + 1;

    const rawEq = cellAt(row, map.eq);
    const rawClassification = cellAt(row, map.classification).toUpperCase();
    const driverName = cellAt(row, map.driverName);
    const navigatorName = cellAt(row, map.navigatorName);

    if (!rawEq && !rawClassification && !driverName && !navigatorName) continue;

    // Numbers can arrive as "12", "12.0" (a spreadsheet number) or "EQ 12".
    const eqMatch = rawEq.match(/\d+/);
    const eq = eqMatch ? Number(eqMatch[0]) : null;

    let error: string | null = null;

    if (eq === null) {
      error = 'No EQ number in this row';
    } else if (!Number.isInteger(eq) || eq < 1 || eq > 100) {
      error = `EQ ${rawEq} is outside 1-100`;
    } else if (seen.has(eq)) {
      error = `EQ ${eq} appears twice (line ${seen.get(eq)})`;
    } else if (rawClassification && !isClassification(rawClassification)) {
      error = `Classification "${rawClassification}" is not B, A, H, I or T`;
    } else if (
      driverName.length > MAX_NAME_LENGTH ||
      navigatorName.length > MAX_NAME_LENGTH
    ) {
      error = 'A name is longer than 200 characters';
    }

    if (eq !== null && error === null) seen.set(eq, lineNumber);

    imported.push({
      lineNumber,
      eq,
      classification: isClassification(rawClassification) ? rawClassification : '',
      driverName,
      navigatorName,
      error,
    });
  }

  return imported;
}

// What is actually sent to the API: the rows that can be imported, stripped of
// the preview's bookkeeping.
export function toPayload(rows: ImportRow[]) {
  return rows
    .filter((row) => row.error === null && row.eq !== null)
    .map((row) => ({
      eq: row.eq as number,
      classification: row.classification,
      driverName: row.driverName,
      navigatorName: row.navigatorName,
    }));
}
