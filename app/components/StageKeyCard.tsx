import React from 'react';
import { maxMerkPenalty, merkFalseLetters, PENALTY_PER_ERROR } from '../lib/scoring';
import {
  maxStageTimePenalty,
  resolveTimeConfig,
  timeRowKind,
  timeRowLabel,
  type StageTimeConfig,
  type TimeKeyRow,
} from '../lib/timeScoring';

export interface StageScoreKeyRow {
  rowNumber: number;
  answers: string[];
  // Answers an appeal ruled equally correct, each a complete answer of its own.
  // The row costs the least of its accepted answers — see app/lib/scoring.ts.
  alternativeAnswers?: string[][];
  falseAnswers?: { column: number; value: string }[];
  maxPenalty?: number;
  // The correct letters of this row have to be given in the order of the key.
  orderMatters?: boolean;
}

export interface StageMerkKeyRow {
  rowNumber: number;
  merk?: string;
  // A letter the key rules out; read as part of the column-wide false set, like
  // `merk` is read as part of the correct one.
  falseMerk?: string;
  maxPenalty?: number;
}

interface StageKeyCardProps {
  scoreKey: StageScoreKeyRow[];
  timeScoreKey?: TimeKeyRow[];
  merkScoreKey?: StageMerkKeyRow[];
  timeConfig?: Partial<StageTimeConfig> | null;
  // The finish of the last stage of a rally disqualifies instead of costing the
  // maximum plus the break, which changes the maximum shown in the overview.
  isFinalStage?: boolean;
}

const LETTER_COLUMNS = 4;

// A stage's answer key laid out as the four columns of the SARK controlekaart —
// ORC's 1-15 | ORC's 16-30 | For Official Use Only (time) | Merk + TOTAAL
// STRAFPUNTEN — so the key reads like the paper card, and like the stage form it
// was typed in and the scored sheets it grades.
const StageKeyCard: React.FC<StageKeyCardProps> = ({
  scoreKey,
  timeScoreKey,
  merkScoreKey,
  timeConfig,
  isFinalStage = true,
}) => {
  const sortedRows = [...(scoreKey || [])].sort((a, b) => a.rowNumber - b.rowNumber);
  const half = Math.ceil(sortedRows.length / 2);
  const leftRows = sortedRows.slice(0, half);
  const rightRows = sortedRows.slice(half);

  const timeRows = timeScoreKey || [];
  const merkRows = merkScoreKey || [];
  const config = resolveTimeConfig(timeConfig);

  const orcTotal = sortedRows.reduce((sum, row) => sum + (row.maxPenalty || 0), 0);
  const tijdTotal = maxStageTimePenalty(timeRows, config, isFinalStage);
  // The merk column is scored vertically, so its maximum is not the sum of the
  // rows: it is one error per distinct letter of the key and one per letter it
  // rules out, bounded by the cap the stage's row maximums add up to.
  const diversenTotal = maxMerkPenalty(merkRows);
  const merkKeyLetters = merkRows
    .map((row) => (row.merk || '').trim().toUpperCase())
    .filter(Boolean);
  // The false letters are a set over the whole column, so they are shown as one
  // list rather than as something belonging to the row they were typed on.
  const merkFalse = merkFalseLetters(merkRows);
  const merkCap = merkRows.reduce((sum, row) => sum + (row.maxPenalty || 0), 0);

  const columnRange = (rows: StageScoreKeyRow[]): string =>
    rows.length > 0 ? `${rows[0].rowNumber}–${rows[rows.length - 1].rowNumber}` : '';

  const answerHeader = (
    <thead>
      <tr className="bg-purple-100">
        <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800 w-10">
          NR
        </th>
        {Array.from({ length: LETTER_COLUMNS }).map((_, colIndex) => (
          <th
            key={colIndex}
            className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800"
          >
            Col {colIndex + 1}
          </th>
        ))}
        <th
          className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800"
          title="Volgorde telt: the correct letters have to be given in the order of the key"
        >
          Volg.
        </th>
        <th className="py-2 px-1 border-b border-gray-300 text-center font-bold text-sm text-gray-800">
          Max
        </th>
      </tr>
    </thead>
  );

  // One key row: per column the correct letter (green), then any answer an
  // appeal ruled equally correct (dashed green), above the explicit false letter
  // (red) — the same stacking the stage form uses for entry.
  const renderKeyRow = (row: StageScoreKeyRow, index: number) => {
    const alternatives = (row.alternativeAnswers || []).filter((variant) =>
      (variant || []).some(Boolean)
    );

    return (
    <tr key={row.rowNumber} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
      <td className="py-1.5 px-1 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center">
        <div className="flex flex-col items-center">
          <span>{row.rowNumber}</span>
          {alternatives.length > 0 && (
            <span
              className="text-[10px] font-bold leading-tight text-green-700"
              title="This row accepts more than one answer (appeal); it costs the least of them"
            >
              of
            </span>
          )}
        </div>
      </td>
      {Array.from({ length: LETTER_COLUMNS }).map((_, colIndex) => {
        const correct = row.answers?.[colIndex] || '';
        const wrong = row.falseAnswers?.find((fa) => fa.column === colIndex)?.value || '';

        return (
          <td key={colIndex} className="py-1.5 px-1 border-b border-r border-gray-300 text-center">
            <div className="flex flex-col items-center space-y-1">
              <div
                className={`w-9 h-9 flex items-center justify-center rounded-md shadow-sm border ${
                  correct
                    ? 'bg-green-100 border-green-300 text-green-800'
                    : 'bg-gray-50 border-gray-200 text-gray-300'
                }`}
                title={correct ? 'Correct answer' : 'No correct answer for this column'}
              >
                <span className="text-lg font-bold">{correct || '-'}</span>
              </div>
              {alternatives.map((variant, altIndex) => {
                const letter = variant[colIndex] || '';
                return (
                  <div
                    key={altIndex}
                    className={`w-9 h-9 flex items-center justify-center rounded-md shadow-sm border border-dashed ${
                      letter
                        ? 'bg-green-50 border-green-400 text-green-800'
                        : 'bg-gray-50 border-gray-200 text-gray-300'
                    }`}
                    title={
                      letter
                        ? `Also correct (appeal ${altIndex + 1})`
                        : `No letter in this column of the alternative answer ${altIndex + 1}`
                    }
                  >
                    <span className="text-lg font-bold">{letter || '-'}</span>
                  </div>
                );
              })}
              <div
                className={`w-9 h-9 flex items-center justify-center rounded-md shadow-sm border ${
                  wrong
                    ? 'bg-red-100 border-red-300 text-red-800'
                    : 'bg-gray-50 border-gray-200 text-gray-300'
                }`}
                title={wrong ? 'False answer' : 'No false answer for this column'}
              >
                <span className="text-lg font-bold">{wrong || '-'}</span>
              </div>
            </div>
          </td>
        );
      })}
      <td className="py-1.5 px-1 border-b border-r border-gray-300 text-center">
        {row.orderMatters ? (
          <span
            className="px-2 py-1 rounded-md bg-purple-100 text-purple-800 border border-purple-300 text-sm font-bold"
            title="The letters of this row have to be given in the order of the key"
          >
            1&rarr;2
          </span>
        ) : (
          <span className="text-gray-300 text-base">-</span>
        )}
      </td>
      <td className="py-1.5 px-1 border-b border-gray-300 text-center">
        <div className="w-12 h-9 mx-auto flex items-center justify-center bg-blue-100 rounded-md shadow-sm border border-blue-200">
          <span className="text-base font-bold text-blue-800">{row.maxPenalty || 0}</span>
        </div>
      </td>
    </tr>
    );
  };

  const orcColumn = (rows: StageScoreKeyRow[]) => (
    <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
      <table className="min-w-full border-collapse">
        {answerHeader}
        <tbody>{rows.map((row, index) => renderKeyRow(row, index))}</tbody>
      </table>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start p-4">
      {/* Columns 1 and 2 — ORC's, split in half like the paper card */}
      {sortedRows.length === 0 ? (
        <p className="text-base text-gray-600">This stage has no answer key rows yet.</p>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-bold mb-1 text-gray-800">
              ORC&apos;s ({columnRange(leftRows)})
            </h3>
            {orcColumn(leftRows)}
            <p className="text-sm text-gray-600 mt-2">
              Green is the correct letter of the column, red an explicit false letter. A false
              letter costs one error ({PENALTY_PER_ERROR}) however often the participant wrote it on
              the row, and as many errors as the key lists it — a letter ruled out twice can cost
              twice. Max is the cap on the penalty of the row. A row marked 1&rarr;2 under Volg. is
              scored on the order of its letters as well: giving them out of order costs one extra
              error ({PENALTY_PER_ERROR}).
            </p>
          </div>

          {rightRows.length > 0 && (
            <div>
              <h3 className="text-sm font-bold mb-1 text-gray-800">
                ORC&apos;s ({columnRange(rightRows)})
              </h3>
              {orcColumn(rightRows)}
            </div>
          )}
        </>
      )}

      {/* Column 3 — Tijd: the stage timetable, written for participant 0 */}
      <div>
        <h3 className="text-sm font-bold mb-1 text-gray-800">Tijd (IPT 0)</h3>
        {timeRows.length === 0 ? (
          <p className="text-base text-gray-600">This stage has no timetable.</p>
        ) : (
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-yellow-100">
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800 w-10">
                    NR
                  </th>
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800">
                    Controle
                  </th>
                  <th className="py-2 px-1 border-b border-gray-300 text-center font-bold text-sm text-gray-800">
                    IPT 0
                  </th>
                </tr>
              </thead>
              <tbody>
                {timeRows.map((row, index) => {
                  // A row without an IPT 0 is not a checkpoint of this stage.
                  const active = Boolean((row.ipt || '').trim());
                  const kind = timeRowKind(row.rowNumber);

                  return (
                    <tr
                      key={row.rowNumber}
                      className={active ? (index % 2 === 0 ? 'bg-white' : 'bg-gray-50') : 'bg-gray-100'}
                    >
                      <td className="py-1.5 px-1 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center">
                        {row.rowNumber}
                      </td>
                      <td
                        className={`py-1.5 px-1 border-b border-r border-gray-300 text-sm font-semibold ${
                          !active ? 'text-gray-400' : kind === 'gtc' ? 'text-gray-700' : 'text-blue-700'
                        }`}
                      >
                        {timeRowLabel(row.rowNumber)}
                      </td>
                      <td
                        className={`py-1.5 px-1 border-b border-gray-300 text-center text-base ${
                          active ? 'text-gray-800' : 'text-gray-400'
                        }`}
                      >
                        {(row.ipt || '').trim() || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-sm text-gray-600 mt-2">
          The ideal passage time of participant 0. Every other participant starts a minute later,
          so participant 12 passes at IPT 0 + 12 minutes. A row without an IPT 0 is not a
          checkpoint of this stage.
        </p>

        {/* Time-penalty settings of this stage */}
        <div className="mt-3 border-2 border-gray-300 rounded-lg shadow-md overflow-hidden">
          <div className="bg-yellow-100 py-2 px-3 font-bold text-sm text-gray-800">
            Tijdstraf instellingen
          </div>
          <table className="min-w-full border-collapse">
            <tbody>
              <tr>
                <td className="py-1 px-3 border-b border-r border-gray-300 text-sm font-semibold text-gray-800">
                  GTC venster (vroeg / laat)
                </td>
                <td className="py-1 px-3 border-b border-gray-300 text-right text-base font-bold text-gray-900">
                  {config.gtcEarlyWindow} / {config.gtcLateWindow} min
                </td>
              </tr>
              <tr>
                <td className="py-1 px-3 border-b border-r border-gray-300 text-sm font-semibold text-gray-800">
                  Finish venster (vroeg / laat)
                </td>
                <td className="py-1 px-3 border-b border-gray-300 text-right text-base font-bold text-gray-900">
                  {config.finishEarlyWindow} / {config.finishLateWindow} min
                </td>
              </tr>
              <tr>
                <td className="py-1 px-3 border-b border-r border-gray-300 text-sm font-semibold text-gray-800">
                  Max strafpunten buiten venster
                </td>
                <td className="py-1 px-3 border-b border-gray-300 text-right text-base font-bold text-gray-900">
                  {config.outOfWindowPenalty}
                </td>
              </tr>
              <tr>
                <td className="py-1 px-3 border-b border-r border-gray-300 text-sm font-semibold text-gray-800">
                  Max strafpunten gemiste finish
                </td>
                <td className="py-1 px-3 border-b border-gray-300 text-right text-base font-bold text-gray-900">
                  {config.missingFinishPenalty}
                </td>
              </tr>
              <tr>
                <td className="py-1 px-3 border-r border-gray-300 text-sm font-semibold text-gray-800">
                  Pauze na deze etappe
                </td>
                <td className="py-1 px-3 text-right text-base font-bold text-gray-900">
                  {config.breakMinutes} min
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-sm text-gray-600 mt-2">
          {isFinalStage
            ? 'This is the last stage of the rally: a participant outside the finish window, or with no finish time at all, is disqualified.'
            : `Another stage follows this one, so a blown finish window costs the maximum plus the break (${config.outOfWindowPenalty} + ${config.breakMinutes} = ${config.outOfWindowPenalty + config.breakMinutes}).`}{' '}
          {`A control with an IPT but no WPT was missed and costs its maximum as well: ${config.outOfWindowPenalty} for a GTC, ${
            isFinalStage
              ? config.missingFinishPenalty
              : `${config.missingFinishPenalty} + ${config.breakMinutes} = ${config.missingFinishPenalty + config.breakMinutes}`
          } for the finish.`}
        </p>
      </div>

      {/* Column 4 — Merk reference + Totaal Strafpunten (max) */}
      <div>
        <h3 className="text-sm font-bold mb-1 text-gray-800">Merk</h3>
        {merkRows.length === 0 ? (
          <p className="text-base text-gray-600">This stage has no merk rows.</p>
        ) : (
          <div className="border-2 border-gray-300 rounded-lg shadow-md overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-orange-100">
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800 w-10">
                    NR
                  </th>
                  <th className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800">
                    Merk
                  </th>
                  <th
                    className="py-2 px-1 border-b border-r border-gray-300 text-center font-bold text-sm text-gray-800"
                    title="Writing this letter anywhere in the column costs one error"
                  >
                    Fout
                  </th>
                  <th
                    className="py-2 px-1 border-b border-gray-300 text-center font-bold text-sm text-gray-800"
                    title="The merk column is capped at the sum of these, not row by row"
                  >
                    Max
                  </th>
                </tr>
              </thead>
              <tbody>
                {merkRows.map((row, index) => (
                  <tr key={row.rowNumber} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1.5 px-1 border-b border-r border-gray-300 font-bold text-base text-gray-800 text-center">
                      {row.rowNumber}
                    </td>
                    <td className="py-1.5 px-2 border-b border-r border-gray-300 text-center text-base font-bold text-green-700">
                      {(row.merk || '').trim().toUpperCase() || '-'}
                    </td>
                    <td className="py-1.5 px-2 border-b border-r border-gray-300 text-center text-base font-bold text-red-700">
                      {(row.falseMerk || '').trim().toUpperCase() || '-'}
                    </td>
                    <td className="py-1.5 px-1 border-b border-gray-300 text-center text-base font-bold text-gray-900">
                      {row.maxPenalty || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totaal Strafpunten overview (max penalties), like the paper card */}
        <div className="mt-3 border-2 border-gray-800 rounded-lg overflow-hidden shadow-md">
          <div className="bg-gray-800 text-white py-1 px-3 text-center font-bold text-sm tracking-wide">
            TOTAAL STRAFPUNTEN (MAX)
          </div>
          <table className="min-w-full border-collapse">
            <tbody>
              <tr>
                <td className="py-1 px-3 border-b border-r border-gray-300 font-semibold text-sm text-gray-800">
                  ORC&apos;s
                </td>
                <td className="py-1 px-3 border-b border-gray-300 text-right font-bold text-lg text-gray-900 w-20">
                  {orcTotal}
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
                  {orcTotal + tijdTotal + diversenTotal}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="text-sm text-gray-700 mt-2 space-y-0.5">
          <p>
            The merk column is scored <span className="font-semibold">vertically</span>: the key
            asks for{' '}
            {merkKeyLetters.length > 0 ? (
              <span className="font-bold">{merkKeyLetters.join(' ')}</span>
            ) : (
              'nothing'
            )}{' '}
            in any rows, in any order. Every key letter given too few or too many times costs{' '}
            {PENALTY_PER_ERROR} points, once. The letters it rules out —{' '}
            {merkFalse.length > 0 ? (
              <span className="font-bold text-red-700">{merkFalse.join(' ')}</span>
            ) : (
              'none'
            )}{' '}
            — cost {PENALTY_PER_ERROR} points each wherever in the column they are written, however
            often. A letter in neither list never costs anything.
            {merkCap > 0 && ` The column is capped at ${merkCap}.`}
          </p>
          <p className="text-gray-600">
            The most a participant can lose on this stage. ORC&apos;s, Tijd and Diversen all count
            towards the standings.
          </p>
        </div>
      </div>
    </div>
  );
};

export default StageKeyCard;
