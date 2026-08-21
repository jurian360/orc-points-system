// Mapping the columns of an officials' spreadsheet onto the fields an import
// needs.
//
// Two importers read files this app did not write — the entry list
// (app/lib/participantImport.ts) and the time sheet of one control
// (app/lib/timeImport.ts). Neither file is exported for us: the entry list
// carries 28 columns, the time export carries the rally code and a comment
// column beside the two values that matter. So both guess the header row and
// the columns by name and then show the guess in selects the official can
// correct. That guessing is the part they share, and it lives here so the two
// cannot drift apart.

// Column index per field; -1 is "this sheet has no such column".
export type ColumnIndexMap<Field extends string> = Record<Field, number>;

// Header names are compared without case, spaces or punctuation, so "EqKlasse",
// "eq klasse" and "mod-wpt" all reduce to something matchable.
export const normalizeHeader = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function emptyColumnMap<Field extends string>(
  fields: readonly Field[]
): ColumnIndexMap<Field> {
  return Object.fromEntries(fields.map((field) => [field, -1])) as ColumnIndexMap<Field>;
}

// Match the header cells against the known names of every field. An exact match
// wins over a "contains" match, so a sheet with both "klasse" and "nklasse"
// (the navigator's own class) still maps the equipe class. A column is used
// once: the first field that claims it keeps it.
export function guessColumnMap<Field extends string>(
  header: string[],
  fields: readonly Field[],
  candidates: Record<Field, string[]>
): ColumnIndexMap<Field> {
  const cells = header.map(normalizeHeader);
  const map = emptyColumnMap(fields);
  const taken = new Set<number>();

  for (const field of fields) {
    const names = candidates[field];

    const exact = cells.findIndex((cell, index) => !taken.has(index) && names.includes(cell));
    const index =
      exact >= 0
        ? exact
        : cells.findIndex(
            (cell, position) =>
              !taken.has(position) &&
              cell.length > 2 &&
              names.some((name) => name.length > 2 && cell.includes(name))
          );

    if (index >= 0) {
      map[field] = index;
      taken.add(index);
    }
  }

  return map;
}

// Which row holds the headers. These sheets sometimes carry a title or a blank
// line above them, so the first rows are scanned for one that names the
// required field and at least `minMatches` fields in total; failing that, the
// first non-empty row is used and the official remaps the columns by hand.
export function findHeaderRowFor<Field extends string>(
  rows: string[][],
  fields: readonly Field[],
  candidates: Record<Field, string[]>,
  required: Field,
  minMatches: number
): number {
  const limit = Math.min(rows.length, 20);

  for (let index = 0; index < limit; index++) {
    const map = guessColumnMap(rows[index], fields, candidates);
    const matched = Object.values(map).filter((column) => (column as number) >= 0).length;
    if (map[required] >= 0 && matched >= minMatches) return index;
  }

  const firstFilled = rows.findIndex((row) => row.some((cell) => cell !== ''));
  return firstFilled < 0 ? 0 : firstFilled;
}

// 0 -> "A", 27 -> "AB". The spreadsheet's own name for a column, so a mapping
// select can be read against the file the official has open next to it.
export function columnLetters(index: number): string {
  let letters = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
  }
  return letters;
}
