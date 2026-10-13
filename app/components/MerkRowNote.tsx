import React from 'react';
import { PENALTY_PER_ERROR, type MerkPenaltyResult, type ScoredMerkRow } from '../lib/scoring';

// What the scored merk column says about its rows, shared by the entry form
// (AnswerSheetForm) and the read-only card (ControlekaartCard) so the two
// cannot describe the same row differently. Each merk row is scored against
// its own key row (app/lib/scoring.ts).

// A row that cost the crew something on its letter.
export function isMerkErrorRow(row: ScoredMerkRow | undefined): boolean {
  return row?.status === 'missing' || row?.status === 'wrong' || row?.status === 'false';
}

function describe(row: ScoredMerkRow): string {
  switch (row.status) {
    case 'missing':
      return `${row.expectedMerk} missing`;
    case 'wrong':
      return `${row.merk} instead of ${row.expectedMerk}`;
    case 'false':
      return row.expectedMerk
        ? `${row.merk} is ruled out, instead of ${row.expectedMerk}`
        : `${row.merk} is ruled out`;
    default:
      return '';
  }
}

// The short tag next to a row's letter.
export function MerkRowNote({
  row,
  className = 'ml-2 text-sm',
}: {
  row: ScoredMerkRow | undefined;
  className?: string;
}) {
  if (!row) return null;

  if (row.status === 'missing') {
    return (
      <span
        className={`${className} font-semibold text-red-700`}
        title={`This row's key asks for ${row.expectedMerk}`}
      >
        {row.expectedMerk} ontbreekt
      </span>
    );
  }
  if (row.status === 'wrong') {
    return (
      <span
        className={`${className} font-semibold text-red-700`}
        title={`This row's key asks for ${row.expectedMerk}`}
      >
        fout, {row.expectedMerk}
      </span>
    );
  }
  if (row.status === 'false') {
    return (
      <span
        className={`${className} font-semibold text-red-700`}
        title="The letter this row's merk key rules out"
      >
        fout
      </span>
    );
  }
  if (row.status === 'ignored') {
    return (
      <span
        className={`${className} text-gray-500`}
        title="This row's merk key neither asks for nor rules out a letter — it never costs points"
      >
        not in key
      </span>
    );
  }
  return null;
}

// The lines under the column: what each row that cost points was charged for,
// and the Diversen fine.
export function MerkSummary({ result }: { result: MerkPenaltyResult }) {
  const errors = result.rows.filter((row) => row.strafp > 0);
  const scoredRows = result.rows.some((row) => row.expectedMerk || row.status !== 'blank');

  return (
    <>
      <p className="text-gray-500">Each row is scored against its own key row.</p>
      {errors.map((row) => (
        <p key={row.rowNumber} className="text-red-700 font-semibold">
          Row {row.rowNumber}: {describe(row)} — {row.strafp}
          {row.capped && <span className="text-gray-500 font-normal"> (row maximum)</span>}
        </p>
      ))}
      {scoredRows && errors.length === 0 && (
        <p className="text-green-700 font-semibold">Column complete — no merk penalty.</p>
      )}
      {result.diversenCount > 0 && (
        <p className="text-red-700 font-semibold">
          Diversen: {result.diversenCount} × {PENALTY_PER_ERROR} = {result.diversenPenalty}
        </p>
      )}
    </>
  );
}
