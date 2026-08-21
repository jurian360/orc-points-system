import React from 'react';
import { calculateTotalPenalty } from '../lib/scoring';
import type { AnswerRow, ScoreKeyRow } from '../lib/scoring';
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
  merkScores,
  disqualified = false,
}) => {
  const timeRows = timePenalties || [];
  const merkRows = merkScores || [];

  // The ORC total is recomputed from the answer key rather than read from the
  // sheet's stored total, so it always agrees with the per-row penalties above
  // it — even if the key was edited after the sheet was submitted.
  const orcPenalty = calculateTotalPenalty(scoreKey, answers);
  const tijdTotal = sumStrafp(timeRows);
  const diversenTotal = sumStrafp(merkRows);

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

      {/* Column 4 — Merk (officials) + Totaal Strafpunten */}
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
                  <tr key={row.rowNumber} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    <td className="py-1.5 px-2 border-b border-r border-gray-300 text-base text-gray-800">
                      {row.merk || '-'}
                    </td>
                    <td className="py-1.5 px-1 border-b border-gray-300 text-center text-base font-bold text-gray-900">
                      {row.strafp || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
          The standings are scored from ORC&apos;s + Tijd ({orcPenalty + tijdTotal}). Diversen is
          recorded by the officials and does not count towards the standings.
        </p>
      </div>
    </div>
  );
};

export default ControlekaartCard;
