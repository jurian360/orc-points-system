// QR code generation.
//
// The officials print one QR code per participant per stage; a participant
// scans it to pull their control card into the Android app. That is the only
// thing this module has to do, so it is a small, self-contained encoder rather
// than a dependency — the same trade-off `app/lib/spreadsheet.ts` makes for
// reading .xlsx files.
//
// Scope: **byte mode, error-correction level M, versions 1-10**. That holds 216
// bytes, an order of magnitude more than the `ADD:<code>` payload the app
// scans, and level M reads reliably off a printed sheet that has been folded
// into a glovebox. Anything longer than version 10 throws rather than silently
// producing a code no phone can read.
//
// The output is a boolean matrix (`true` = dark module); rendering it is the
// caller's job (see app/components/QrCode.tsx).
//
// Shared by the server and the browser on purpose — it imports nothing.

// --- Capacity tables (ISO/IEC 18004, level M) ------------------------------

interface VersionSpec {
  // Error-correction codewords per block.
  ecPerBlock: number;
  // Blocks of the two groups: [count, data codewords per block].
  groups: [number, number][];
  // Row/column centres of the alignment patterns; empty on version 1.
  alignment: number[];
}

// The remainder bits a symbol carries after the interleaved codewords are not
// tabulated: the data placement below reads a zero past the end of the
// codewords, which is exactly what those bits are.

const VERSIONS: Record<number, VersionSpec> = {
  1: { ecPerBlock: 10, groups: [[1, 16]], alignment: [] },
  2: { ecPerBlock: 16, groups: [[1, 28]], alignment: [6, 18] },
  3: { ecPerBlock: 26, groups: [[1, 44]], alignment: [6, 22] },
  4: { ecPerBlock: 18, groups: [[2, 32]], alignment: [6, 26] },
  5: { ecPerBlock: 24, groups: [[2, 43]], alignment: [6, 30] },
  6: { ecPerBlock: 16, groups: [[4, 27]], alignment: [6, 34] },
  7: { ecPerBlock: 18, groups: [[4, 31]], alignment: [6, 22, 38] },
  8: { ecPerBlock: 22, groups: [[2, 38], [2, 39]], alignment: [6, 24, 42] },
  9: { ecPerBlock: 22, groups: [[3, 36], [2, 37]], alignment: [6, 26, 46] },
  10: { ecPerBlock: 26, groups: [[4, 43], [1, 44]], alignment: [6, 28, 50] },
};

const MAX_VERSION = 10;

// Total data codewords of a version, i.e. what the payload has to fit in.
function dataCapacity(spec: VersionSpec): number {
  return spec.groups.reduce((total, [count, size]) => total + count * size, 0);
}

export class QrPayloadTooLongError extends Error {}

// --- GF(256) arithmetic for the Reed-Solomon error correction --------------

// Log/antilog tables over GF(256) with the QR primitive polynomial 0x11D.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  // Doubled so a product of two logs can be looked up without a modulo.
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// Generator polynomial of `degree` error-correction codewords.
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// The remainder of dividing the data block by the generator polynomial — the
// error-correction codewords of that block.
function encodeBlock(data: number[], ecLength: number): number[] {
  const generator = generatorPoly(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLength; i++) {
        remainder[i] ^= gfMul(generator[i + 1], factor);
      }
    }
  }

  return remainder;
}

// --- Bit buffer ------------------------------------------------------------

class BitBuffer {
  private bits: number[] = [];

  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }

  get length() {
    return this.bits.length;
  }

  // Pad to a whole number of bytes and read them out.
  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

// --- Payload encoding ------------------------------------------------------

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

// Smallest version that holds the payload. The character-count indicator is 8
// bits up to version 9 and 16 bits from version 10, so the fit is checked
// against the version being tried, not against a fixed header size.
function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const spec = VERSIONS[version];
    const countBits = version < 10 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (needed <= dataCapacity(spec) * 8) return version;
  }
  throw new QrPayloadTooLongError(
    `QR payload of ${byteLength} bytes does not fit in version ${MAX_VERSION}`
  );
}

// Mode indicator, length, data, terminator and the alternating pad bytes.
function buildDataCodewords(bytes: number[], version: number): number[] {
  const spec = VERSIONS[version];
  const capacity = dataCapacity(spec);
  const buffer = new BitBuffer();

  buffer.push(0b0100, 4); // byte mode
  buffer.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.push(byte, 8);

  // Terminator: up to four zero bits, truncated when the buffer is nearly full.
  const terminator = Math.min(4, capacity * 8 - buffer.length);
  if (terminator > 0) buffer.push(0, terminator);

  // Pad the last codeword out with zeros.
  const overflow = buffer.length % 8;
  if (overflow !== 0) buffer.push(0, 8 - overflow);

  const codewords = buffer.toBytes();
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < capacity; i++) codewords.push(PAD[i % 2]);

  return codewords;
}

// Split into blocks, error-correct each, then interleave: codeword i of every
// data block, then codeword i of every EC block.
function interleave(codewords: number[], version: number): number[] {
  const spec = VERSIONS[version];

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];

  let offset = 0;
  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const block = codewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(encodeBlock(block, spec.ecPerBlock));
    }
  }

  const result: number[] = [];

  const longestData = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < longestData; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const block of ecBlocks) result.push(block[i]);
  }

  return result;
}

// --- Module placement ------------------------------------------------------

// `null` means "not written yet"; the function patterns are written first so
// the data placement can skip them.
type Grid = (boolean | null)[][];

function emptyGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function placeFinder(grid: Grid, row: number, col: number) {
  // The 7x7 finder plus its one-module separator, clipped to the grid.
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || y >= grid.length || x < 0 || x >= grid.length) continue;
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      grid[y][x] = inside && (ring || core);
    }
  }
}

function placeAlignment(grid: Grid, centres: number[]) {
  for (const row of centres) {
    for (const col of centres) {
      // The three centres that would collide with a finder pattern are skipped.
      if (grid[row][col] !== null) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const outer = Math.abs(r) === 2 || Math.abs(c) === 2;
          grid[row + r][col + c] = outer || (r === 0 && c === 0);
        }
      }
    }
  }
}

function placeTiming(grid: Grid) {
  const size = grid.length;
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (grid[6][i] === null) grid[6][i] = dark;
    if (grid[i][6] === null) grid[i][6] = dark;
  }
}

// The modules the format information occupies, reserved before the data is
// laid out and filled in afterwards (they depend on the chosen mask).
function reserveFormat(grid: Grid) {
  const size = grid.length;
  for (let i = 0; i < 9; i++) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    grid[8][size - 1 - i] = false;
    grid[size - 1 - i][8] = false;
  }
  // The module that is always dark.
  grid[size - 8][8] = true;
}

function reserveVersion(grid: Grid, version: number) {
  if (version < 7) return;
  const size = grid.length;
  for (let i = 0; i < 18; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    grid[row][size - 11 + col] = false;
    grid[size - 11 + col][row] = false;
  }
}

// BCH(15,5) format information: 2 bits of EC level (M = 0b00), 3 bits of mask.
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let value = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((value >>> i) & 1) value ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

// BCH(18,6) version information, versions 7 and up.
function versionBits(version: number): number {
  let value = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((value >>> i) & 1) value ^= 0b1111100100101 << (i - 12);
  }
  return (version << 12) | value;
}

function writeFormat(grid: boolean[][], mask: number) {
  const size = grid.length;
  const bits = formatBits(mask);

  for (let i = 0; i < 15; i++) {
    const bit = ((bits >>> i) & 1) === 1;

    // One copy hugs the top-left finder: down column 8, then left along row 8.
    if (i < 6) grid[i][8] = bit;
    else if (i === 6) grid[7][8] = bit;
    else if (i === 7) grid[8][8] = bit;
    else if (i === 8) grid[8][7] = bit;
    else grid[8][14 - i] = bit;

    // The second copy is split between the other two finders: the low bits run
    // right along row 8, the high bits down column 8 from the bottom-left.
    if (i < 8) grid[8][size - 1 - i] = bit;
    else grid[size - 15 + i][8] = bit;
  }
}

function writeVersion(grid: boolean[][], version: number) {
  if (version < 7) return;
  const size = grid.length;
  const bits = versionBits(version);

  for (let i = 0; i < 18; i++) {
    const bit = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = i % 3;
    grid[row][size - 11 + col] = bit;
    grid[size - 11 + col][row] = bit;
  }
}

// The zigzag: two-module-wide columns from the right, upwards then downwards,
// skipping the vertical timing pattern.
function placeData(grid: Grid, codewords: number[]) {
  const size = grid.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the timing column is not part of the zigzag

    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;

      for (const col of [right, right - 1]) {
        if (grid[row][col] !== null) continue;

        const byte = codewords[bitIndex >>> 3];
        const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIndex & 7))) & 1;
        grid[row][col] = bit === 1;
        bitIndex++;
      }
    }

    upward = !upward;
  }
}

const MASKS: ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// The four penalty rules of the standard; the mask with the lowest total wins.
function maskPenalty(modules: boolean[][]): number {
  const size = modules.length;
  let penalty = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const read of [
      (j: number) => modules[i][j],
      (j: number) => modules[j][i],
    ]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (read(j) === read(j - 1)) {
          run++;
        } else {
          if (run >= 5) penalty += run - 2;
          run = 1;
        }
      }
      if (run >= 5) penalty += run - 2;
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const first = modules[r][c];
      if (
        modules[r][c + 1] === first &&
        modules[r + 1][c] === first &&
        modules[r + 1][c + 1] === first
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 pattern with four light modules beside it.
  const PATTERN = [true, false, true, true, true, false, true];
  const matches = (read: (j: number) => boolean, start: number): boolean =>
    PATTERN.every((want, offset) => read(start + offset) === want);
  const light = (read: (j: number) => boolean, start: number): boolean => {
    for (let i = 0; i < 4; i++) {
      const j = start + i;
      if (j < 0 || j >= size) continue; // the quiet zone counts as light
      if (read(j)) return false;
    }
    return true;
  };

  for (let i = 0; i < size; i++) {
    for (const read of [
      (j: number) => modules[i][j],
      (j: number) => modules[j][i],
    ]) {
      for (let j = 0; j <= size - 7; j++) {
        if (!matches(read, j)) continue;
        if (light(read, j - 4) || light(read, j + 7)) penalty += 40;
      }
    }
  }

  // Rule 4: deviation of the dark-module ratio from 50%.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  const percent = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

export interface QrMatrix {
  // Side of the symbol in modules, excluding the quiet zone.
  size: number;
  // Row-major modules; `true` is dark.
  modules: boolean[][];
  version: number;
}

// Encode `text` as a QR symbol. Throws `QrPayloadTooLongError` for a payload
// that does not fit in version 10 — the callers here encode a short code, so
// that is a programming error rather than something to render.
export function encodeQr(text: string): QrMatrix {
  const bytes = utf8Bytes(text);
  const version = chooseVersion(bytes.length);
  const spec = VERSIONS[version];
  const size = version * 4 + 17;

  const codewords = interleave(buildDataCodewords(bytes, version), version);

  const grid = emptyGrid(size);
  placeFinder(grid, 0, 0);
  placeFinder(grid, 0, size - 7);
  placeFinder(grid, size - 7, 0);
  placeAlignment(grid, spec.alignment);
  placeTiming(grid);
  reserveVersion(grid, version);
  reserveFormat(grid);

  // Snapshot of which modules are function patterns: the mask applies only to
  // the data region, and the format/version areas are already written.
  const reserved = grid.map((row) => row.map((module) => module !== null));
  placeData(grid, codewords);

  const base = grid.map((row) => row.map((module) => module === true));

  let best: boolean[][] | null = null;
  let bestPenalty = Infinity;

  for (let mask = 0; mask < MASKS.length; mask++) {
    const candidate = base.map((row, r) =>
      row.map((module, c) => (!reserved[r][c] && MASKS[mask](r, c) ? !module : module))
    );
    // The format and version bits are never masked, so they are written after
    // the mask and before the symbol is scored.
    writeFormat(candidate, mask);
    writeVersion(candidate, version);

    const penalty = maskPenalty(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = candidate;
    }
  }

  return { size, modules: best as boolean[][], version };
}

// The dark modules of a matrix as one SVG path. A path of "move to,
// horizontal run" segments is far smaller than one rect per module, and prints
// identically. `quietZone` is the margin in modules; the standard asks for 4
// and a printed code needs them.
export function qrPathData(matrix: QrMatrix, quietZone = 4): string {
  const parts: string[] = [];

  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.modules[row][col]) {
        col++;
        continue;
      }
      let run = 1;
      while (col + run < matrix.size && matrix.modules[row][col + run]) run++;
      parts.push(`M${col + quietZone} ${row + quietZone}h${run}v1h-${run}z`);
      col += run;
    }
  }

  return parts.join('');
}

// Side of the rendered symbol in modules, quiet zone included — the viewBox a
// caller needs around `qrPathData`.
export function qrViewBoxSize(matrix: QrMatrix, quietZone = 4): number {
  return matrix.size + quietZone * 2;
}

// Render a matrix as a standalone SVG document. React callers use the two
// helpers above and render the elements themselves (app/components/QrCode.tsx);
// this is for anything that needs the markup as a string.
export function qrToSvg(matrix: QrMatrix, options: { quietZone?: number } = {}): string {
  const quiet = options.quietZone ?? 4;
  const side = qrViewBoxSize(matrix, quiet);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${side}" height="${side}" fill="#ffffff"/>` +
    `<path d="${qrPathData(matrix, quiet)}" fill="#000000"/>` +
    `</svg>`
  );
}
