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

import {
  emptyColumnMap,
  findHeaderRowFor,
  guessColumnMap,
  type ColumnIndexMap,
} from './columnMapping';
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

const FIELDS = IMPORT_FIELDS.map(({ field }) => field);

// Column index per field; -1 is "this sheet has no such column".
export type ColumnMap = ColumnIndexMap<ImportField>;

export const EMPTY_COLUMN_MAP: ColumnMap = emptyColumnMap(FIELDS);

// Header names seen on rally entry lists, best match first. Dutch and English
// both appear; `b` is "bestuurder" (driver) and `n` is the navigator, which is
// how the exports from the entry system name their columns.
const HEADER_CANDIDATES: Record<ImportField, string[]> = {
  eq: ['equipe', 'eq', 'eqno', 'eqnr', 'eqnumber', 'nummer', 'number', 'startnummer', 'startno'],
  classification: ['eqklasse', 'klasse', 'classification', 'class', 'categorie', 'category'],
  driverName: ['bnaam', 'bestuurder', 'driver', 'drivername', 'chauffeur', 'rijder'],
  navigatorName: ['nnaam', 'navigator', 'navigatorname', 'nav', 'bijrijder'],
};

// Which row holds the headers, and which column is which: guessed here, shown
// to the official in the import panel, and corrected there when a sheet names
// its columns something these lists do not know yet.
export function findHeaderRow(rows: string[][]): number {
  return findHeaderRowFor(rows, FIELDS, HEADER_CANDIDATES, 'eq', 2);
}

export function guessColumns(header: string[]): ColumnMap {
  return guessColumnMap(header, FIELDS, HEADER_CANDIDATES);
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
