import React from 'react';
import { calculateMerkPenalty, calculateTotalPenalty } from '../lib/scoring';
import type { AnswerRow, MerkKeyRow, ScoreKeyRow } from '../lib/scoring';
import { timeRowLabel } from '../lib/timeScoring';
import OrcAnswerGrid from './OrcAnswerGrid';

export interface TimePenaltyRow {
  rowNumber: number;
  ipt?: string;
  wpt?: string;
  plusMinus?: string;
  strafp?: number;
  outOfWindow?: boolean;
}

export interface MerkScoreRow {
  rowNumber: number;
  merk?: string;
  strafp?: number;
}

export const sumStrafp = (rows: { strafp?: number }[]) =>
  rows.reduce((total, row) => total + (row.strafp || 0), 0);

interface ControlekaartCardProps {
  scoreKey: ScoreKeyRow[];
  answers: AnswerRow[];
  timePenalties?: TimePenaltyRow[];
  // The stage's merk key and the letters the participant wrote. Like the ORC's,
  // the merk column is scored here from the key rather than read off the sheet,
  // so the card always agrees with itself.
  merkScoreKey?: MerkKeyRow[];
  merkScores?: MerkScoreRow[];
  disqualified?: boolean;
}

// One submitted answer sheet laid out as the four columns of the SARK
// controlekaart — ORC's 1-15 | ORC's 16-30 | For Official Use Only (time) |
// Merk + TOTAAL STRAFPUNTEN — so a scored sheet reads like the paper card the
// answers were copied from, and matches the entry form column for column.
//
// Shared by the single-sheet scoring view and the participant overview, which
// render it for one sheet and for every stage of a rally respectively.
const ControlekaartCard: React.FC<ControlekaartCardProps> = ({
  scoreKey,
  answers,
  timePenalties,
  merkScoreKey,
  merkScores,
  disqualified = false,
}) => {
  const timeRows = timePenalties || [];

  // The ORC and the merk total are recomputed from the stage's keys rather than
  // read from the sheet's stored totals, so they always agree with the per-row
  // penalties above them — even if a key was edited after the sheet was
  // submitted. The time total cannot be recomputed here (it depends on the rest
  // of the rally), so it is summed from the rows the server stored.
  const orcPenalty = calculateTotalPenalty(scoreKey, answers);
  const tijdTotal = sumStrafp(timeRows);
  const merkResult = calculateMerkPenalty(merkScoreKey, merkScores);
  const merkRows = merkResult.rows;
  const diversenTotal = merkResult.totalPenalty;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start p-4">
      {/* Columns 1 and 2 — ORC's, split in half */}
      <OrcAnswerGrid scoreKey={scoreKey} answers={answers} />

      {/* Column 3 — For official use only (IPT / WPT / +/- / STRAFP) */}
      <div>
        <h3 className="text-sm font-bold mb-1 text-gray-800">Tijd</h3>
        {timeRows.length === 0 ? (
          <p className="text-base text-gray-600">No time entries on this sheet.</p>
        ) : (
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-yellow-100">
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800 w-10">NR</th>
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800">Controle</th>
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800">IPT</th>
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800">WPT</th>
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800">+/-</th>
                  <th className="py-2 px-1 border-b border-gray-300 text-center font-bold text-sm text-gray-800">Strafp.</th>
                </tr>
              </thead>
              <tbody>
                {timeRows.map((row, index) => (
                  <tr
                    key={row.rowNumber}
                    className={
                      row.outOfWindow ? 'bg-red-50' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    }
                  >
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 text-sm font-semibold text-gray-700">
                      {timeRowLabel(row.rowNumber)}
                    </td>
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 text-center text-base text-gray-800">
                      {row.ipt || '-'}
                    </td>
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 text-center text-base text-gray-800">
                      {row.wpt || '-'}
                    </td>
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 text-center text-base text-gray-800">
                      {row.plusMinus || '-'}
                    </td>
                    <td
                      className={`py-1.5 px-1 border-b border-gray-300 text-center text-base font-bold ${
                        row.outOfWindow ? 'text-red-700' : 'text-gray-900'
                      }`}
                    >
                      {row.strafp || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {disqualified && (
          <p className="mt-2 px-2 py-1 rounded bg-red-100 text-red-800 text-sm font-bold">
            Disqualified — outside the finish window of the last stage.
          </p>
        )}
      </div>

      {/* Column 4 — Merk + Totaal Strafpunten */}
      <div>
        <h3 className="text-sm font-bold mb-1 text-gray-800">Merk</h3>
        {merkRows.length === 0 ? (
          <p className="text-base text-gray-600">No merk entries on this sheet.</p>
        ) : (
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-orange-100">
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800 w-10">NR</th>
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800">Merk</th>
                  <th className="py-2 px-1 border-b border-gray-300 text-center font-bold text-sm text-gray-800">Strafp.</th>
                </tr>
              </thead>
              <tbody>
                {merkRows.map((row, index) => (
                  <tr
                    key={row.rowNumber}
                    className={
                      row.status === 'double' ||
                      row.status === 'false' ||
                      row.status === 'missing'
                        ? 'bg-red-50'
                        : index % 2 === 0
                          ? 'bg-white'
                          : 'bg-gray-50'
                    }
                  >
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    <td className="py-1.5 px-2 border-b border-r border-gray-300 text-base text-gray-800">
                      <span className="font-bold">{row.merk || '-'}</span>
                      {row.status === 'double' && (
                        <span className="ml-2 text-sm font-semibold text-red-700">double</span>
                      )}
                      {row.status === 'false' && (
                        <span
                          className="ml-2 text-sm font-semibold text-red-700"
                          title="A letter this stage's merk key rules out"
                        >
                          fout
                        </span>
                      )}
                      {row.status === 'missing' && (
                        <span
                          className="ml-2 text-sm font-semibold text-red-700"
                          title="A letter of this stage's merk key the column never got"
                        >
                          {row.missingMerk} ontbreekt
                        </span>
                      )}
                      {row.status === 'ignored' && (
                        <span
                          className="ml-2 text-sm text-gray-500"
                          title="In neither list of this stage's merk key — it never costs points"
                        >
                          not in key
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-1.5 px-1 border-b border-gray-300 text-center text-base font-bold ${
                        row.strafp ? 'text-red-700' : 'text-gray-900'
                      }`}
                    >
                      {row.strafp || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The merk check is vertical, so the errors belong to the column, not
            to a row. A missing letter is still shown on an empty row — the key
            row that asks for it when it is free — so the column adds up. */}
        <div className="mt-2 text-sm text-gray-700 space-y-0.5">
          <p>
            <span className="font-semibold">Key:</span>{' '}
            {merkResult.keyLetters.length > 0 ? merkResult.keyLetters.join(' ') : '—'}
            {merkResult.keyLetters.length > 0 && (
              <span className="text-gray-500"> (in any row, in any order)</span>
            )}
          </p>
          {merkResult.falseLetters.length > 0 && (
            <p>
              <span className="font-semibold">Ruled out:</span>{' '}
              <span className="text-red-700 font-bold">
                {merkResult.falseLetters.join(' ')}
              </span>
              <span className="text-gray-500"> (30 points each, in any row)</span>
            </p>
          )}
          {merkResult.missing.length > 0 && (
            <p className="text-red-700 font-semibold">
              Missing: {merkResult.missing.join(' ')} — {merkResult.missing.length * 30} points
            </p>
          )}
          {merkResult.doubled.length > 0 && (
            <p className="text-red-700 font-semibold">
              Doubled: {merkResult.doubled.join(' ')} — {merkResult.doubled.length * 30} points
            </p>
          )}
          {merkResult.falseGiven.length > 0 && (
            <p className="text-red-700 font-semibold">
              False: {merkResult.falseGiven.join(' ')} — {merkResult.falseGiven.length * 30} points
            </p>
          )}
          {(merkResult.keyLetters.length > 0 || merkResult.falseLetters.length > 0) &&
            merkResult.missing.length === 0 &&
            merkResult.doubled.length === 0 &&
            merkResult.falseGiven.length === 0 && (
              <p className="text-green-700 font-semibold">Column complete — no merk penalty.</p>
            )}
          {merkResult.capped && (
            <p className="text-gray-600">Capped at the stage maximum of {merkResult.maxPenalty}.</p>
          )}
        </div>

        {/* Totaal Strafpunten overview, like the paper card */}
        <div className="mt-3 border-2 border-gray-800 rounded-lg overflow-hidden shadow-md">
          <div className="bg-gray-800 text-white py-1 px-3 text-center font-bold text-sm tracking-wide">
            TOTAAL STRAFPUNTEN
          </div>
          <table className="min-w-full border-collapse">
            <tbody>
              <tr>
                <td className="py-1 px-3 border-b border-r border-gray-300 font-semibold text-sm text-gray-800">
                  ORC&apos;s
                </td>
                <td className="py-1 px-3 border-b border-gray-300 text-right font-bold text-lg text-gray-900 w-20">
                  {orcPenalty}
                </td>
              </tr>
              <tr>
                <td className="py-1 px-3 border-b border-r border-gray-300 font-semibold text-sm text-gray-800">
                  Tijd
                </td>
                <td className="py-1 px-3 border-b border-gray-300 text-right font-bold text-lg text-gray-900">
                  {tijdTotal}
                </td>
              </tr>
              <tr>
                <td className="py-1 px-3 border-b border-r border-gray-300 font-semibold text-sm text-gray-800">
                  Diversen
                </td>
                <td className="py-1 px-3 border-b border-gray-300 text-right font-bold text-lg text-gray-900">
                  {diversenTotal}
                </td>
              </tr>
              <tr className="bg-gray-100">
                <td className="py-1.5 px-3 border-r border-gray-300 font-bold text-base text-gray-900">
                  Totaal
                </td>
                <td className="py-1.5 px-3 text-right font-extrabold text-xl text-red-600">
                  {orcPenalty + tijdTotal + diversenTotal}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-sm text-gray-600 mt-2">
          The standings are scored from ORC&apos;s + Tijd + Diversen — every point on this card
          counts.
        </p>
      </div>
    </div>
  );
};

export default ControlekaartCard;
