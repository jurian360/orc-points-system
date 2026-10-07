// What an official typed on a card, as one comparable string — pure and shared
// client + server.
//
// A sheet holds two kinds of field: the ones typed off the paper card (the ORC
// letters, a WPT per time row, the merk letters, the Diversen count) and the
// ones derived from them by the scoring. Only the first kind is the card. The
// offline upload (app/api/rallies/[id]/sync) compares two sheets on it to
// recognise a request it already applied — a phone that lost the response to
// an upload and sends it again — and the offline workspace (app/offline) to
// tell whether its copy of a card still differs from the server's.
//
// Empty cells are left out, so a row the form sent blank and a row a sheet
// never had read the same: neither holds anything an official wrote.

import { isMerkLetterRow } from './scoring';

export interface TypedSheetFields {
  answers?: readonly { rowNumber?: number; selectedAnswers?: readonly string[] }[];
  timePenalties?: readonly { rowNumber?: number; wpt?: string }[];
  merkScores?: readonly { rowNumber?: number; merk?: string }[];
  diversenCount?: number;
}

export function typedSheetContent(sheet: TypedSheetFields): string {
  const answers = (sheet.answers || [])
    .map((row) => ({
      rowNumber: Number(row?.rowNumber) || 0,
      letters: (row?.selectedAnswers || []).map((letter) => String(letter ?? '').trim()),
    }))
    .filter((row) => row.letters.some(Boolean))
    // The columns stay in place: `A _ B` and `A B _` are two different cards.
    .map((row) => `${row.rowNumber}:${row.letters.join(',')}`)
    .sort();

  const times = (sheet.timePenalties || [])
    .map((row) => ({ rowNumber: Number(row?.rowNumber) || 0, wpt: String(row?.wpt ?? '').trim() }))
    .filter((row) => row.wpt)
    .map((row) => `${row.rowNumber}:${row.wpt}`)
    .sort();

  // The Diversen row is a count, not a letter (app/lib/scoring.ts), and a
  // re-score drops whatever letter is left on it — so it is not part of the
  // letters here, and the count is compared on its own.
  const merk = (sheet.merkScores || [])
    .filter((row) => isMerkLetterRow(row?.rowNumber))
    .map((row) => ({ rowNumber: Number(row?.rowNumber) || 0, merk: String(row?.merk ?? '').trim() }))
    .filter((row) => row.merk)
    .map((row) => `${row.rowNumber}:${row.merk}`)
    .sort();

  return JSON.stringify([answers, times, merk, Number(sheet.diversenCount) || 0]);
}
