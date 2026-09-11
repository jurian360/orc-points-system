// Turning a spreadsheet of a **finished rally's results** into the crews and
// the finishing order of a rally in this app.
//
// The club has years of results on paper: a finishing order, the two names in
// each car and their classes, and no strafpunten behind any of it — those
// rallies were ridden before this system existed, so there are no answer
// sheets and no score keys to re-score from. A rally imported this way carries
// its finishing order and nothing else, which is exactly what the overall
// standings need: a season is ranked on positions, not on points
// (app/lib/seasons.ts).
//
// It is a sibling of `participantImport.ts` — same spreadsheet reader, same
// column-guessing, same "preview it before you write it" shape — and differs
// in three ways worth knowing:
//
//   * **Both riders are required.** An entry list may be typed before anybody
//     is registered; a *result* names two people who rode, and a crew with a
//     hole in it cannot be placed in a season.
//   * **The classes in the file are the riders' own**, and are only used to
//     fill in a rider the register does not have a class for. A rider who
//     already has one keeps it: a historical sheet must not undo a later
//     promotion.
//   * **The crew class column is a check, not a value.** A crew's class is
//     derived from its two riders, so the column is compared with what the
//     file's own rider classes come to and a disagreement is shown as a
//     warning — the sheet is usually right about the crew and wrong about a
//     rider, and that is worth seeing before importing 56 rows.
//
// Every row is validated here before it is shown, with the same rules the API
// applies. That is a preview, not a guard: the import route re-validates
// everything it is sent.

import {
  emptyColumnMap,
  findHeaderRowFor,
  guessColumnMap,
  type ColumnIndexMap,
} from './columnMapping';
import {
  CLASSIFICATION_LIST,
  crewClassification,
  isClassification,
  type ClassificationValue,
} from './participants';
import { isValidEmail, normalizeEmail } from './persons';
import type { StandingsStatus } from './standings';

export const MAX_NAME_LENGTH = 200;

// The columns a results sheet can supply. The position and both riders are
// required; the three class columns and the crew class are not, because an
// older sheet may not carry them.
export type ResultField =
  | 'position'
  | 'crewClassification'
  | 'driverName'
  | 'driverEmail'
  | 'driverClassification'
  | 'navigatorName'
  | 'navigatorEmail'
  | 'navigatorClassification';

export const RESULT_FIELDS: { field: ResultField; label: string; required: boolean }[] = [
  { field: 'position', label: 'Finish position', required: true },
  { field: 'driverName', label: 'Driver', required: true },
  { field: 'driverEmail', label: 'Driver e-mail', required: true },
  { field: 'driverClassification', label: 'Driver class', required: false },
  { field: 'navigatorName', label: 'Navigator', required: true },
  { field: 'navigatorEmail', label: 'Navigator e-mail', required: true },
  { field: 'navigatorClassification', label: 'Navigator class', required: false },
  { field: 'crewClassification', label: 'Crew class', required: false },
];

const FIELDS = RESULT_FIELDS.map(({ field }) => field);

export type ResultColumnMap = ColumnIndexMap<ResultField>;

export const EMPTY_RESULT_COLUMN_MAP: ResultColumnMap = emptyColumnMap(FIELDS);

// Header names seen on the club's result sheets, best match first. Dutch and
// English both appear; `b` is "bestuurder" (driver) and `n` the navigator,
// which is how the entry system's exports name their columns.
const HEADER_CANDIDATES: Record<ResultField, string[]> = {
  position: [
    'positie', 'plaats', 'plts', 'pos', 'position', 'place', 'finish', 'finishposition',
    'uitslag', 'rang', 'rank',
  ],
  crewClassification: ['eqklasse', 'equipeklasse', 'crewklasse', 'klasse', 'class', 'crewclass'],
  driverName: ['bnaam', 'bestuurder', 'driver', 'drivername', 'chauffeur', 'rijder'],
  driverEmail: ['bemail', 'bmail', 'driveremail', 'emailbestuurder', 'emaildriver'],
  driverClassification: [
    'bklasse', 'klassebestuurder', 'driverclass', 'driverclassification', 'bclass',
  ],
  navigatorName: ['nnaam', 'navigator', 'navigatorname', 'nav', 'bijrijder'],
  navigatorEmail: ['nemail', 'nmail', 'navigatoremail', 'emailnavigator', 'emailbijrijder'],
  navigatorClassification: [
    'nklasse', 'klassenavigator', 'navigatorclass', 'navigatorclassification', 'nclass',
  ],
};

export function findResultHeaderRow(rows: string[][]): number {
  return findHeaderRowFor(rows, FIELDS, HEADER_CANDIDATES, 'position', 2);
}

export function guessResultColumns(header: string[]): ResultColumnMap {
  return guessColumnMap(header, FIELDS, HEADER_CANDIDATES);
}

// One result as read from the sheet.
export interface ResultRow {
  // 1-based line number in the sheet, so a reported problem can be found back.
  lineNumber: number;
  // The place this crew finished. 0 for a crew who did not finish — `status`
  // says which of DNF and DNS they were.
  position: number;
  status: StandingsStatus;
  driverName: string;
  driverEmail: string;
  driverClassification: ClassificationValue;
  navigatorName: string;
  navigatorEmail: string;
  navigatorClassification: ClassificationValue;
  // The crew class the sheet states, if it has a column for it. Only ever
  // compared with the derived one.
  statedCrewClassification: ClassificationValue;
  // What the two riders' classes actually come to.
  derivedCrewClassification: ClassificationValue;
  // Set when the row cannot be imported; those rows are shown with their
  // reason and left out.
  error: string | null;
  // Set when the row imports but something about it is worth a second look —
  // today, only a crew class that disagrees with its two riders.
  warning: string | null;
}

const cellAt = (row: string[], column: number): string =>
  column >= 0 ? (row[column] ?? '').trim() : '';

const classAt = (row: string[], column: number): string =>
  cellAt(row, column).toUpperCase();

// What a finish-position cell means. A sheet writes a place as "1", "1." or
// "1e", and a crew who did not finish as DNF / DNS / a dash / nothing at all.
function readPosition(raw: string): { position: number; status: StandingsStatus } | null {
  const value = raw.trim().toUpperCase();

  if (value === '' || value === '-' || value === '—') return null;
  if (value.startsWith('DNS') || value === 'NS') return { position: 0, status: 'dns' };
  if (value.startsWith('DNF') || value === 'NF' || value.startsWith('UIT')) {
    return { position: 0, status: 'dnf' };
  }

  const digits = value.match(/\d+/);
  if (!digits) return null;

  const position = Number(digits[0]);
  if (!Number.isInteger(position) || position < 1 || position > 500) return null;

  return { position, status: 'finished' };
}

// The sheet, read through the column map: one row per crew, in sheet order.
// Rows where every mapped cell is empty are dropped rather than reported — a
// trailing blank line is not a mistake worth showing.
export function buildResultRows(
  rows: string[][],
  headerRowIndex: number,
  map: ResultColumnMap
): ResultRow[] {
  // Two crews cannot share a place, and a rider cannot be in two cars. Both
  // are caught here so the preview names the line, rather than left to the
  // unique indexes to fail the write halfway through.
  const seenPosition = new Map<number, number>();
  const seenEmail = new Map<string, number>();

  const imported: ResultRow[] = [];

  for (let index = headerRowIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const lineNumber = index + 1;

    const rawPosition = cellAt(row, map.position);
    const driverName = cellAt(row, map.driverName);
    const navigatorName = cellAt(row, map.navigatorName);
    const driverEmail = normalizeEmail(cellAt(row, map.driverEmail));
    const navigatorEmail = normalizeEmail(cellAt(row, map.navigatorEmail));
    const driverClass = classAt(row, map.driverClassification);
    const navigatorClass = classAt(row, map.navigatorClassification);
    const crewClass = classAt(row, map.crewClassification);

    if (
      !rawPosition && !driverName && !navigatorName && !driverEmail && !navigatorEmail
    ) {
      continue;
    }

    const place = readPosition(rawPosition);

    const driverClassification = isClassification(driverClass) ? driverClass : '';
    const navigatorClassification = isClassification(navigatorClass) ? navigatorClass : '';
    const statedCrewClassification = isClassification(crewClass) ? crewClass : '';
    const derivedCrewClassification = crewClassification(
      driverClassification,
      navigatorClassification
    );

    let error: string | null = null;
    let warning: string | null = null;

    if (place === null) {
      error = `"${rawPosition}" is not a finish position, DNF or DNS`;
    } else if (!driverName || !navigatorName) {
      error = 'A result needs both names';
    } else if (driverName.length > MAX_NAME_LENGTH || navigatorName.length > MAX_NAME_LENGTH) {
      error = 'A name is longer than 200 characters';
    } else if (!driverEmail || !navigatorEmail) {
      // The addresses are what make these rows *riders* rather than text, and
      // a season is awarded to two identified people.
      error = 'A result needs an e-mail address for both seats';
    } else if (!isValidEmail(driverEmail)) {
      error = `"${driverEmail}" is not an e-mail address`;
    } else if (!isValidEmail(navigatorEmail)) {
      error = `"${navigatorEmail}" is not an e-mail address`;
    } else if (driverEmail === navigatorEmail) {
      error = 'The driver and the navigator are the same rider';
    } else if (driverClass && !isClassification(driverClass)) {
      error = `Driver class "${driverClass}" is not ${CLASSIFICATION_LIST}`;
    } else if (navigatorClass && !isClassification(navigatorClass)) {
      error = `Navigator class "${navigatorClass}" is not ${CLASSIFICATION_LIST}`;
    } else if (seenEmail.has(driverEmail)) {
      error = `${driverEmail} is already in this import (line ${seenEmail.get(driverEmail)})`;
    } else if (seenEmail.has(navigatorEmail)) {
      error = `${navigatorEmail} is already in this import (line ${seenEmail.get(
        navigatorEmail
      )})`;
    } else if (place.status === 'finished' && seenPosition.has(place.position)) {
      error = `Position ${place.position} is already taken (line ${seenPosition.get(
        place.position
      )})`;
    }

    if (error === null && place !== null) {
      seenEmail.set(driverEmail, lineNumber);
      seenEmail.set(navigatorEmail, lineNumber);
      if (place.status === 'finished') seenPosition.set(place.position, lineNumber);

      // Not an error: the sheet is usually right about the crew and wrong
      // about one of the riders, and the fix is in the register rather than
      // in the file. Worth seeing before importing 56 rows, though.
      if (statedCrewClassification && statedCrewClassification !== derivedCrewClassification) {
        warning =
          `Sheet says crew class ${statedCrewClassification}, ` +
          `the two riders give ${derivedCrewClassification || 'none'}`;
      }
    }

    imported.push({
      lineNumber,
      position: place?.position ?? 0,
      status: place?.status ?? 'dnf',
      driverName,
      driverEmail,
      driverClassification,
      navigatorName,
      navigatorEmail,
      navigatorClassification,
      statedCrewClassification,
      derivedCrewClassification,
      error,
      warning,
    });
  }

  return imported;
}

// What is actually sent to the API: the rows that can be imported, stripped of
// the preview's bookkeeping. The derived crew class is not sent — the server
// derives it again from the riders it resolves, so a browser cannot claim a
// class the pair does not hold.
export function toResultPayload(rows: ResultRow[]) {
  return rows
    .filter((row) => row.error === null)
    .map((row) => ({
      position: row.position,
      status: row.status,
      driverName: row.driverName,
      driverEmail: row.driverEmail,
      driverClassification: row.driverClassification,
      navigatorName: row.navigatorName,
      navigatorEmail: row.navigatorEmail,
      navigatorClassification: row.navigatorClassification,
    }));
}
