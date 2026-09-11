// Turning a spreadsheet of an entry list into the crews of a rally.
//
// The sheets officials get are not written for this app: the file this was
// built against ("DR2026-controle") carries 28 columns, of which a handful
// matter — the equipe number, the two names and, where the sheet has them, the
// two e-mail addresses. So the columns are guessed by header name and then
// shown to the official to confirm or change, rather than being fixed by
// position.
//
// **The addresses are what make an import a registration.** A rider is
// identified by their e-mail (app/lib/persons.ts), so a row that carries one
// per seat is matched to the register — creating the rider if this is their
// first rally — and the entry comes out as a real crew: two named people who
// can be grouped across a season. A row with only names still imports, but as
// an entry with nobody in it yet; an official links the riders afterwards, and
// until they do that entry is scored in its own rally and counts towards no
// overall standing.
//
// **There is no classification column any more**, and that is forced rather
// than chosen: a class belongs to a *rider* now, and a crew's class is derived
// from its two riders (app/lib/participants.ts). The single per-crew class an
// entry list carries cannot be stored — writing it onto both riders would
// promote the weaker half of every mixed crew — so classes are set in the
// register, where they carry a history and an owner.
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
import { isValidEmail, normalizeEmail } from './persons';

export const MAX_NAME_LENGTH = 200;

// The fields an entry list can supply. `eq` is the only required one — a crew
// whose riders are not yet known is still a participant of the rally.
export type ImportField =
  | 'eq'
  | 'driverName'
  | 'driverEmail'
  | 'navigatorName'
  | 'navigatorEmail';

export const IMPORT_FIELDS: { field: ImportField; label: string; required: boolean }[] = [
  { field: 'eq', label: 'EQ. No.', required: true },
  { field: 'driverName', label: 'Driver', required: false },
  { field: 'driverEmail', label: 'Driver e-mail', required: false },
  { field: 'navigatorName', label: 'Navigator', required: false },
  { field: 'navigatorEmail', label: 'Navigator e-mail', required: false },
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
  driverName: ['bnaam', 'bestuurder', 'driver', 'drivername', 'chauffeur', 'rijder'],
  driverEmail: ['bemail', 'bmail', 'driveremail', 'emailbestuurder', 'emaildriver'],
  navigatorName: ['nnaam', 'navigator', 'navigatorname', 'nav', 'bijrijder'],
  navigatorEmail: ['nemail', 'nmail', 'navigatoremail', 'emailnavigator', 'emailbijrijder'],
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
  driverName: string;
  driverEmail: string;
  navigatorName: string;
  navigatorEmail: string;
  error: string | null;
}

// True for a row that will come out as a real crew — two riders the register
// can identify. The panel counts these, because "48 imported, 12 of them
// without riders" is what an official needs to know before they walk away from
// the screen.
export function importsAsCrew(row: ImportRow): boolean {
  return Boolean(row.driverEmail && row.navigatorEmail);
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
    const driverName = cellAt(row, map.driverName);
    const navigatorName = cellAt(row, map.navigatorName);
    const driverEmail = normalizeEmail(cellAt(row, map.driverEmail));
    const navigatorEmail = normalizeEmail(cellAt(row, map.navigatorEmail));

    if (!rawEq && !driverName && !navigatorName && !driverEmail && !navigatorEmail) continue;

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
    } else if (
      driverName.length > MAX_NAME_LENGTH ||
      navigatorName.length > MAX_NAME_LENGTH
    ) {
      error = 'A name is longer than 200 characters';
    } else if (driverEmail && !isValidEmail(driverEmail)) {
      error = `"${driverEmail}" is not an e-mail address`;
    } else if (navigatorEmail && !isValidEmail(navigatorEmail)) {
      error = `"${navigatorEmail}" is not an e-mail address`;
    } else if (driverEmail && driverEmail === navigatorEmail) {
      error = 'The driver and the navigator have the same e-mail address';
    } else if (Boolean(driverEmail) !== Boolean(navigatorEmail)) {
      // Half a crew is not a crew: the season groups on the pair, and a pair
      // with a hole in it would quietly drop out of every standing it rode.
      error = 'This row has an e-mail address for only one of the two seats';
    } else if ((driverEmail && !driverName) || (navigatorEmail && !navigatorName)) {
      // A rider this import may have to create needs a name to be created
      // with — the register has no other way to say who they are.
      error = 'A member with an e-mail address also needs a name';
    }

    if (eq !== null && error === null) seen.set(eq, lineNumber);

    imported.push({
      lineNumber,
      eq,
      driverName,
      driverEmail,
      navigatorName,
      navigatorEmail,
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
      driverName: row.driverName,
      driverEmail: row.driverEmail,
      navigatorName: row.navigatorName,
      navigatorEmail: row.navigatorEmail,
    }));
}
