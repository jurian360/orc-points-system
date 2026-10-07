// Turning the export of a time control into the WPT's of one stage row.
//
// The times of a GTC are not typed in one by one: the control hands in its own
// export — the reference files carry `rallycode, gtc, eq, wpt, mod-wpt,
// comment` — with one line per participant number, always the full 1..100 even
// though only the crews that actually passed have a time. Those files are read
// in the browser (app/lib/spreadsheet.ts) and mapped here onto the two values
// this app needs: which participant, and when they passed.
//
// What a row means depends on the rally, so this is given what the wizard
// already knows — who the participants are and which of them already have a
// sheet for the stage — and returns, per line, what importing it would do. The
// import route re-validates everything it is sent; this is the preview.

import {
  emptyColumnMap,
  findHeaderRowFor,
  guessColumnMap,
  type ColumnIndexMap,
} from './columnMapping';
import { formatClock, parseClock } from './timeScoring';

// The columns a time export has to supply. `control` is optional and only ever
// used to leave rows out: a file that holds more than one control (or that was
// exported for a different one) can be filtered on it.
export type TimeImportField = 'eq' | 'wpt' | 'control';

export const TIME_IMPORT_FIELDS: {
  field: TimeImportField;
  label: string;
  required: boolean;
  hint: string;
}[] = [
  { field: 'eq', label: 'Participant (EQ)', required: true, hint: 'The equipe number, 1-100.' },
  {
    field: 'wpt',
    label: 'Time (WPT)',
    required: true,
    hint: 'The time the participant passed. These exports usually hold both "wpt" and a corrected "mod-wpt".',
  },
  {
    field: 'control',
    label: 'Control number',
    required: false,
    hint: 'Optional. Only used to leave the rows of other controls out.',
  },
];

const FIELDS = TIME_IMPORT_FIELDS.map(({ field }) => field);

export type TimeColumnMap = ColumnIndexMap<TimeImportField>;

export const EMPTY_TIME_COLUMN_MAP: TimeColumnMap = emptyColumnMap(FIELDS);

// Header names seen on the exports of time controls. "post" is what the control
// itself is called on the card; `type` is deliberately not a candidate — in the
// reference file it holds the kind ("gtc"), not the number of the control.
const HEADER_CANDIDATES: Record<TimeImportField, string[]> = {
  eq: ['eq', 'equipe', 'eqno', 'eqnr', 'eqnumber', 'nummer', 'number', 'startnummer', 'startno', 'deelnemer'],
  wpt: ['wpt', 'modwpt', 'tijd', 'time', 'passeertijd', 'werkelijketijd', 'aankomst', 'arrival'],
  control: ['gtc', 'post', 'controle', 'control', 'checkpoint'],
};

export function findTimeHeaderRow(rows: string[][]): number {
  return findHeaderRowFor(rows, FIELDS, HEADER_CANDIDATES, 'eq', 2);
}

export function guessTimeColumns(header: string[]): TimeColumnMap {
  return guessColumnMap(header, FIELDS, HEADER_CANDIDATES);
}

// A cell holding a passage time, as "HH:MM" — or null when it is not a time.
//
// Officials' files write the time as text ("19:27"), which is what
// `parseClock` already reads. A workbook where the column is a real time cell
// stores a fraction of a day instead (19:27 is 0.81041666…), and a date+time
// as whole days plus that fraction. Only a fraction of three digits or more is
// read that way: "19.27" is a time an official typed, not a serial.
export function parseSheetTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const serial = /^(\d+)[.,](\d{3,})$/.exec(trimmed);
  if (serial) {
    const days = Number(`${serial[1]}.${serial[2]}`);
    if (!Number.isFinite(days)) return null;
    return formatClock(Math.round((days - Math.floor(days)) * 1440));
  }

  const minutes = parseClock(trimmed);
  return minutes === null ? null : formatClock(minutes);
}

// What the rally already knows about the sheet being imported.
export interface TimeImportContext {
  // The EQ numbers that have a participant record in this rally. A time is
  // only imported for a crew that is in the entry list; a line for any other
  // number is ignored.
  participantEqs: ReadonlySet<number>;
  // The EQ numbers that already have an answer sheet for this stage.
  sheetEqs: ReadonlySet<number>;
  // Whether a participant without a sheet for this stage gets one.
  createMissingSheets: boolean;
  // Value of the control column to keep; '' imports every row.
  controlValue: string;
}

// What importing one line of the file would do.
//   update — an existing sheet gets this time on the chosen row
//   create — a new sheet is written for this participant with only this time
//   skip   — nothing to import here (no time, another control, or a crew that
//            is not in the entry list)
//   error  — the line cannot be imported and stops the whole import
export type TimeImportOutcome = 'update' | 'create' | 'skip' | 'error';

export interface TimeImportRow {
  // 1-based line number in the file, so a reported problem can be found back.
  lineNumber: number;
  eq: number | null;
  rawEq: string;
  rawWpt: string;
  // The time as it will be stored, "HH:MM"; '' when the row carries none.
  wpt: string;
  control: string;
  outcome: TimeImportOutcome;
  // Why the row is skipped, or what is wrong with it.
  message: string;
  // Skipped because the EQ is not a participant of this rally. Counted on its
  // own in the preview, so an official sees how much of the file was ignored.
  notEntered: boolean;
}

const cellAt = (row: string[], column: number): string =>
  column >= 0 ? (row[column] ?? '').trim() : '';

// Every distinct value of the mapped control column, in the order the file
// lists them — what the wizard offers to filter on, and what it checks the
// chosen row against.
export function controlValues(
  rows: string[][],
  headerRowIndex: number,
  map: TimeColumnMap
): string[] {
  if (map.control < 0) return [];

  const values: string[] = [];
  for (let index = headerRowIndex + 1; index < rows.length; index++) {
    const value = cellAt(rows[index], map.control);
    if (value && !values.includes(value)) values.push(value);
    if (values.length >= 20) break;
  }
  return values;
}

// The file, read through the column map: one entry per line, in file order.
// Lines where every mapped cell is empty are dropped rather than reported — the
// blank line at the end of an export is not a mistake worth showing.
export function buildTimeImportRows(
  rows: string[][],
  headerRowIndex: number,
  map: TimeColumnMap,
  context: TimeImportContext
): TimeImportRow[] {
  const seen = new Map<number, number>();
  const imported: TimeImportRow[] = [];

  for (let index = headerRowIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const lineNumber = index + 1;

    const rawEq = cellAt(row, map.eq);
    const rawWpt = cellAt(row, map.wpt);
    const control = cellAt(row, map.control);

    if (!rawEq && !rawWpt && !control) continue;

    // Numbers can arrive as "12", "12.0" (a spreadsheet number) or "EQ 12".
    const eqMatch = rawEq.match(/\d+/);
    const eq = eqMatch ? Number(eqMatch[0]) : null;
    const wpt = parseSheetTime(rawWpt);

    const entry: TimeImportRow = {
      lineNumber,
      eq,
      rawEq,
      rawWpt,
      wpt: wpt ?? '',
      control,
      outcome: 'skip',
      message: '',
      notEntered: false,
    };

    // A file for another control is left out before anything else is judged:
    // its EQ numbers are not this control's business.
    if (context.controlValue && control !== context.controlValue) {
      entry.message = `Control ${control || '—'}`;
      imported.push(entry);
      continue;
    }

    // The export lists all 100 numbers whether they passed or not, so a line
    // without a time is the normal case, not a problem. Nothing is cleared by
    // an import: a control that has no time here keeps whatever the card says.
    if (!rawWpt) {
      entry.message = 'No time on this line';
      imported.push(entry);
      continue;
    }

    // A control's export can hold more crews than this rally has entered — the
    // full 1..100, or the field of another event run on the same course. Only
    // the crews in the entry list are imported; every other line is ignored,
    // whatever is on it, because it is not this rally's business. That check
    // comes before the time is read, so a bad cell on an ignored line does not
    // stop the import either.
    if (eq === null) {
      entry.outcome = 'error';
      entry.message = 'A time without an EQ number';
    } else if (!context.participantEqs.has(eq)) {
      entry.notEntered = true;
      entry.message = `EQ ${eq} is not in the entry list — ignored`;
    } else if (seen.has(eq)) {
      entry.outcome = 'error';
      entry.message = `EQ ${eq} has a time twice (line ${seen.get(eq)})`;
    } else if (wpt === null) {
      entry.outcome = 'error';
      entry.message = `"${rawWpt}" is not a time — use 19:27`;
    } else if (context.sheetEqs.has(eq)) {
      entry.outcome = 'update';
      entry.message = 'Sets the time on the existing sheet';
    } else if (context.createMissingSheets) {
      entry.outcome = 'create';
      entry.message = 'Creates a sheet for this stage';
    } else {
      entry.message = 'No sheet for this stage yet';
    }

    if (eq !== null && entry.outcome !== 'error' && !entry.notEntered) seen.set(eq, lineNumber);

    imported.push(entry);
  }

  return imported;
}

// What is actually sent to the API: the lines that carry a time to import,
// stripped of the preview's bookkeeping.
export function toTimePayload(rows: TimeImportRow[]) {
  return rows
    .filter((row) => (row.outcome === 'update' || row.outcome === 'create') && row.eq !== null)
    .map((row) => ({ eq: row.eq as number, wpt: row.wpt }));
}
