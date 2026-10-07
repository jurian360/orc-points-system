'use client';

// The standings table: rank (or DNF / DNS), EQ, class, crew, sheets and the
// three parts of the total. Rendered by the rally dashboard's Standings tab and
// by the offline workspace (app/offline), over the same `StandingsEntry` shape
// — the one `buildStandings` (app/lib/standingsBuild.ts) returns — so a
// standing read without a connection looks exactly like the one online.

import React from 'react';
import Link from 'next/link';
import ClassificationBadge from './ClassificationBadge';
import { crewLabel, type ClassificationValue } from '../lib/participants';
import { isRanked, STATUS_LABEL, STATUS_TITLE, type StandingsStatus } from '../lib/standings';

export interface StandingsTableEntry {
  eq: number;
  classification: ClassificationValue | '';
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  // The parts of totalPenalty, so the table can show where the points came
  // from: the ORC's (letters), the Tijd (time) and the Diversen (merk) penalty.
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  sheetsSubmitted: number;
  // The stages this crew has no sheet for. Each one is scored as a blank card,
  // and those points are already in the totals above.
  missingSheets: number;
  disqualified: boolean;
  // Finished, did not finish, did not start (app/lib/standings.ts). Only a
  // finished crew has a place; the other two are ranked behind the field.
  status: StandingsStatus;
  rank: number;
}

interface StandingsTableProps {
  // The entries to list — already filtered by the caller's search and class.
  entries: StandingsTableEntry[];
  // Whether the rally has any standings at all, so an empty filter result and
  // an empty rally say different things.
  hasStandings: boolean;
  totalStages: number;
  // Where an EQ links to; plain text when absent (the offline workspace has no
  // per-crew page).
  eqHref?: (eq: number) => string;
  // The last column's buttons; no Actions column when absent.
  renderActions?: (entry: StandingsTableEntry) => React.ReactNode;
}

export default function StandingsTable({
  entries,
  hasStandings,
  totalStages,
  eqHref,
  renderActions,
}: StandingsTableProps) {
  return (
    !hasStandings ? (
          <div className="p-8 text-center">
            <p className="text-lg text-gray-600">
              No answer sheets submitted yet. Standings will appear once participants have
              sheets.
            </p>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-lg text-gray-600">No participant matches this filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    EQ
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Class
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Driver / Navigator
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Sheets
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    ORC&apos;s
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Tijd
                  </th>
                  <th
                    className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider"
                    title="The merk column of every sheet"
                  >
                    Diversen
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Total
                  </th>
                  {renderActions && (
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {entries.map((entry) => (
                  <tr
                    key={entry.eq}
                    className={
                      entry.status === 'dns'
                        ? 'bg-gray-100'
                        : entry.status === 'dnf'
                          ? 'bg-red-50'
                          : entry.rank === 1
                            ? 'bg-yellow-50'
                            : 'hover:bg-gray-50'
                    }
                  >
                    {/* A crew who did not finish, and one who never started,
                        have no place: they are behind the field because the
                        table has to put them somewhere, not because they
                        came 32nd. The status is shown instead of a number. */}
                    <td className="px-4 py-2 whitespace-nowrap">
                      {isRanked(entry.status) ? (
                        <span className="text-base font-bold text-gray-900">
                          {entry.rank}
                          {entry.rank === 1 && (
                            <span className="ml-2" title="Winner">🏆</span>
                          )}
                        </span>
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded text-sm font-bold ${
                            entry.status === 'dns'
                              ? 'bg-gray-200 text-gray-700'
                              : 'bg-red-100 text-red-800'
                          }`}
                          title={STATUS_TITLE[entry.status]}
                        >
                          {STATUS_LABEL[entry.status]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {eqHref ? (
                        <Link
                          href={eqHref(entry.eq)}
                          className="text-base font-bold text-blue-600 hover:underline"
                        >
                          {entry.eq}
                        </Link>
                      ) : (
                        <span className="text-base font-bold text-gray-900">{entry.eq}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <ClassificationBadge classification={entry.classification} />
                    </td>
                    <td className="px-4 py-2">
                      <span className="text-base text-gray-800">
                        {crewLabel(entry) || <span className="text-gray-400">—</span>}
                      </span>
                    </td>
                    {/* A crew short of a card is marked here: the stages
                        they have no sheet for are in their total as blank
                        cards, which is why their points can be high without
                        a typed card behind them. */}
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span
                        className={`text-base ${
                          entry.missingSheets > 0
                            ? 'font-semibold text-amber-700'
                            : 'text-gray-600'
                        }`}
                        title={
                          entry.missingSheets > 0
                            ? `${entry.missingSheets} stage${
                                entry.missingSheets === 1 ? '' : 's'
                              } without a sheet — scored as a blank card`
                            : undefined
                        }
                      >
                        {entry.sheetsSubmitted}
                        {totalStages > 0 ? ` / ${totalStages}` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-right">
                      <span className="text-base text-gray-600">{entry.orcPenalty}</span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-right">
                      <span className="text-base text-gray-600">{entry.timePenalty}</span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-right">
                      <span className="text-base text-gray-600">{entry.merkPenalty}</span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-right">
                      <span className="text-base font-bold text-red-600">
                        {entry.totalPenalty}
                      </span>
                    </td>
                    {renderActions && (
                      <td className="px-4 py-2 whitespace-nowrap text-right">
                        <div className="flex justify-end space-x-4">{renderActions(entry)}</div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
  );
}
