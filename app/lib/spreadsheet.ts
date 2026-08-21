// Reading a spreadsheet in the browser, without a third-party parser.
//
// An .xlsx file is a ZIP of XML parts, and both halves of that are already in
// the browser: `DecompressionStream('deflate-raw')` inflates the entries and
// `DOMParser` reads the XML. That keeps a file-format parser — the classic
// place for a supply-chain or a memory-exhaustion problem — out of the
// dependency list, and it is only ever handed a file the official picked
// themselves.
//
// Everything here runs client-side: officials pick a file, the sheet is turned
// into rows here, and only the mapped participant rows are sent to the API as
// ordinary JSON. The file itself never leaves the browser, so the API keeps its
// 256 KB object-only JSON body guard.
//
// The result is deliberately dumb: a grid of trimmed strings. Interpreting the
// columns is app/lib/participantImport.ts's job.

// Bounds. A rally entry list is tens of rows; these are what keeps a malformed
// or hostile file from exhausting the tab's memory.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 200;

export class SpreadsheetError extends Error {}

// --- ZIP ------------------------------------------------------------------

interface ZipEntry {
  offset: number;
  compression: number;
  compressedSize: number;
}

// Locate the End Of Central Directory record and read the entries it lists.
// Only what is needed to find a part by name: no zip64, no encryption.
function readZipDirectory(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The EOCD sits at the end, behind a comment of at most 64 KB.
  let eocd = -1;
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetError('This file is not a valid .xlsx workbook.');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) {
    throw new SpreadsheetError('This workbook uses the ZIP64 format, which is not supported.');
  }

  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.set(name, { offset: localOffset, compression, compressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buffer);

  if (view.getUint32(entry.offset, true) !== 0x04034b50) {
    throw new SpreadsheetError('This .xlsx workbook is damaged.');
  }

  // The local header repeats the name and extra-field lengths; the compressed
  // data starts right behind them.
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = new Uint8Array(buffer, start, entry.compressedSize);

  if (entry.compression === 0) return new TextDecoder().decode(data);
  if (entry.compression !== 8) {
    throw new SpreadsheetError('This workbook uses an unsupported compression method.');
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new SpreadsheetError(
      'This browser cannot read .xlsx files. Save the sheet as CSV and import that instead.'
    );
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

// --- XLSX -----------------------------------------------------------------

// "BC" -> 54. Column letters are the only place the sheet XML says where a cell
// belongs; a row may skip empty cells entirely.
function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const value = char.charCodeAt(0);
    if (value < 65 || value > 90) break; // digits: the row part of "BC12"
    index = index * 26 + (value - 64);
  }
  return index - 1;
}

function parseXml(xml: string, what: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new SpreadsheetError(`This workbook could not be read (${what}).`);
  }
  return document;
}

// Shared strings are stored once and referenced by index. A single string can
// still be split over several runs (`<r><t>`), so all of them are joined.
function readSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const document = parseXml(xml, 'shared strings');
  return Array.from(document.getElementsByTagName('si')).map((si) =>
    Array.from(si.getElementsByTagName('t'))
      .map((t) => t.textContent || '')
      .join('')
  );
}

// The first sheet of the workbook, resolved through the workbook relationships
// rather than assumed to be `sheet1.xml` — the first sheet in the tab order is
// not always the first file.
function firstSheetPath(workbookXml: string | null, relsXml: string | null): string {
  const fallback = 'xl/worksheets/sheet1.xml';
  if (!workbookXml || !relsXml) return fallback;

  const sheet = parseXml(workbookXml, 'workbook').getElementsByTagName('sheet')[0];
  const relationshipId = sheet?.getAttribute('r:id') || sheet?.getAttribute('id');
  if (!relationshipId) return fallback;

  const relationship = Array.from(
    parseXml(relsXml, 'workbook relationships').getElementsByTagName('Relationship')
  ).find((candidate) => candidate.getAttribute('Id') === relationshipId);

  const target = relationship?.getAttribute('Target');
  if (!target) return fallback;

  // Targets are relative to xl/, and may be written as "/xl/worksheets/…".
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

function readSheet(xml: string, sharedStrings: string[]): string[][] {
  const document = parseXml(xml, 'worksheet');
  const rows: string[][] = [];

  for (const row of Array.from(document.getElementsByTagName('row'))) {
    if (rows.length >= MAX_ROWS) break;

    const cells: string[] = [];
    let column = 0;

    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const reference = cell.getAttribute('r');
      const index = reference ? columnIndex(reference) : column;
      if (index < 0 || index >= MAX_COLUMNS) continue;

      const type = cell.getAttribute('t');
      let value = '';

      if (type === 'inlineStr') {
        value = Array.from(cell.getElementsByTagName('t'))
          .map((t) => t.textContent || '')
          .join('');
      } else {
        const raw = cell.getElementsByTagName('v')[0]?.textContent || '';
        value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
      }

      while (cells.length < index) cells.push('');
      cells[index] = value.trim();
      column = index + 1;
    }

    rows.push(cells);
  }

  return rows;
}

// --- CSV ------------------------------------------------------------------

// Kept alongside the .xlsx reader as the way out of a workbook this cannot
// read: any spreadsheet can save one, and "save as CSV" is the advice the error
// messages give.
export function parseCsv(text: string): string[][] {
  // Excel writes semicolons in locales where the comma is the decimal
  // separator. The count is taken over the first lines that hold something
  // rather than over the first line alone: entry lists often open with a title
  // line, which carries no delimiter at all and would decide this on nothing.
  const sample = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(0, 10)
    .join('\n');
  const delimiter =
    (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = () => {
    row.push(field.trim());
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length && rows.length < MAX_ROWS; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) endField();
    else if (char === '\n') endRow();
    else if (char !== '\r') field += char;
  }

  if (field || row.length > 0) endRow();

  return rows;
}

// --- Entry point ----------------------------------------------------------

// One spreadsheet as a grid of trimmed strings, whatever it was saved as.
export async function readSpreadsheet(file: File): Promise<string[][]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new SpreadsheetError('This file is larger than 5 MB — that is not an entry list.');
  }

  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());

  if (!/\.xlsx$/i.test(file.name)) {
    throw new SpreadsheetError(
      'Pick an .xlsx workbook or a .csv file. The old .xls format has to be saved as .xlsx first.'
    );
  }

  const buffer = await file.arrayBuffer();
  const entries = readZipDirectory(buffer);

  const read = async (name: string): Promise<string | null> => {
    const entry = entries.get(name);
    return entry ? readZipEntry(buffer, entry) : null;
  };

  const [workbookXml, relsXml, sharedStringsXml] = await Promise.all([
    read('xl/workbook.xml'),
    read('xl/_rels/workbook.xml.rels'),
    read('xl/sharedStrings.xml'),
  ]);

  const sheetXml = await read(firstSheetPath(workbookXml, relsXml));
  if (!sheetXml) throw new SpreadsheetError('This workbook has no readable sheet.');

  return readSheet(sheetXml, readSharedStrings(sharedStringsXml));
}
