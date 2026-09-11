'use client';

import React from 'react';
import Link from 'next/link';
import ClassificationBadge from './ClassificationBadge';
import { SEAT_LABEL } from '../lib/crews';
import { personLabel, vehicleLabel } from '../lib/persons';
import { countingRuleLabel } from '../lib/seasons';
import { STATUS_LABEL, STATUS_TITLE } from '../lib/standings';
import type { RiderResults } from '../types';

interface RiderResultsViewProps {
  results: RiderResults;
  // True when this is the rider looking at themselves, which changes nothing
  // but the wording — "you" reads badly on an official's screen and stiffly on
  // the rider's own.
  isSelf?: boolean;
  // Officials can open the rally a result came from; a rider cannot, so their
  // dashboard shows the rally as plain text.
  linkRallies?: boolean;
}

function formatDate(value: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// One rider's history: which rallies they rode, who with, and how it went.
//
// Shared by the rider's own dashboard (`/participant`) and by an official
// looking at that rider (`/persons/[id]`), because they are the same question
// and a dashboard that disagreed with what the official sees would be worse
// than no dashboard. The data behind both is one server module too
// (`app/lib/riderResults.ts`).
const RiderResultsView: React.FC<RiderResultsViewProps> = ({
  results,
  isSelf = false,
  linkRallies = true,
}) => {
  const { person, entries, seasons } = results;

  const drove = entries.filter((entry) => entry.seat === 'driver').length;
  const navigated = entries.length - drove;

  return (
    <div className="space-y-6">
      {/* --- The rider ---------------------------------------------------- */}
      <section className="bg-white rounded-xl shadow p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{personLabel(person)}</h2>
            <p className="text-gray-600 text-base">{person.email}</p>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <ClassificationBadge
                classification={person.classification}
                fallback="No class yet"
              />
              {person.classificationChangedAt && (
                <span className="text-sm text-gray-500">
                  since {formatDate(person.classificationChangedAt)}
                </span>
              )}
            </div>
          </div>
          <dl className="text-base text-gray-700 space-y-1">
            <div className="flex gap-2">
              <dt className="text-gray-500">Rallies:</dt>
              <dd className="font-semibold">{entries.length}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-500">Drove / navigated:</dt>
              <dd className="font-semibold">
                {drove} / {navigated}
              </dd>
            </div>
            {person.phone && (
              <div className="flex gap-2">
                <dt className="text-gray-500">Phone:</dt>
                <dd>{person.phone}</dd>
              </div>
            )}
            {person.foodRestrictions && (
              <div className="flex gap-2 max-w-sm">
                <dt className="text-gray-500 whitespace-nowrap">Food:</dt>
                <dd>{person.foodRestrictions}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      {/* --- The crews of each season -------------------------------------
          A rider can be in more than one crew in a year: three rallies with
          Jan and three with Piet is two crews, and both are placed. That is
          why this is a list per season rather than one line. */}
      {seasons.map((season) => (
        <section key={season.year} className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-xl font-semibold text-gray-800">
              {season.year} — {isSelf ? 'your crews' : 'crews'}
            </h3>
            <p className="text-gray-600 text-sm mt-1">{countingRuleLabel(season.settings)}</p>
          </div>

          {season.crews.length === 0 ? (
            <p className="px-6 py-4 text-base text-gray-600">
              No official rally of {season.year} with a registered crew.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {season.crews.map((crew) => {
                const short = season.settings.minimumRallies - crew.ralliesRidden;

                return (
                  <li key={crew.crewKey} className="px-6 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div>
                        <span className="text-base font-semibold text-gray-900">
                          {crew.label}
                        </span>
                        <ClassificationBadge classification={crew.classification} />
                      </div>
                      <div className="text-base">
                        {crew.eligible ? (
                          <span className="text-gray-800">
                            <span className="font-bold">#{crew.rank}</span> overall ·{' '}
                            <span className="font-bold">{crew.totalPenalty}</span> strafpunten
                            from {crew.countedResults} result
                            {crew.countedResults === 1 ? '' : 's'}
                          </span>
                        ) : (
                          // Not a failure — a statement of how far off they
                          // are. A crew one rally short should see that.
                          <span className="text-amber-700">
                            {crew.ralliesRidden} of {season.settings.minimumRallies} rallies —{' '}
                            {short} more together to be placed
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {/* --- Every rally, newest first ------------------------------------ */}
      <section className="bg-white rounded-xl shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-xl font-semibold text-gray-800">
            {isSelf ? 'Your rallies' : 'Rallies'}
          </h3>
        </div>

        {entries.length === 0 ? (
          <p className="px-6 py-8 text-center text-lg text-gray-600">
            {isSelf
              ? 'You have not been entered in a rally yet.'
              : 'This rider has not been entered in a rally yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  {['Rally', 'Date', 'EQ', 'Seat', 'With', 'Car', 'Place', 'Strafpunten'].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider"
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {entries.map((entry) => (
                  <tr key={`${entry.rallyId}-${entry.eq}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-base text-gray-900">
                      {linkRallies ? (
                        <Link
                          href={`/rallies/${entry.rallyId}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {entry.rallyName}
                        </Link>
                      ) : (
                        <span className="font-medium">{entry.rallyName}</span>
                      )}
                      {/* An unofficial rit is ridden and scored, and counts
                          towards nothing. Marked here so a reader is not left
                          wondering why it is missing from the season above. */}
                      {!entry.countsForSeason && (
                        <span className="block text-sm text-gray-500">
                          unofficial — not in the season
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-base text-gray-700 whitespace-nowrap">
                      {formatDate(entry.date)}
                    </td>
                    <td className="px-4 py-2 text-base font-bold text-gray-900">{entry.eq}</td>
                    <td className="px-4 py-2 text-base text-gray-700">
                      {SEAT_LABEL[entry.seat]}
                    </td>
                    <td className="px-4 py-2 text-base text-gray-700">
                      {entry.partner ? (
                        entry.partner.name
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-base text-gray-700">
                      {vehicleLabel(entry.vehicle) || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-base whitespace-nowrap">
                      {entry.result === null ? (
                        <span className="text-gray-400">—</span>
                      ) : entry.result.rank > 0 ? (
                        <span className="font-bold text-gray-900">
                          {entry.result.rank}
                          <span className="font-normal text-gray-500">
                            {' '}
                            of {entry.result.fieldSize}
                          </span>
                        </span>
                      ) : (
                        <span
                          className="font-bold text-red-700"
                          title={STATUS_TITLE[entry.result.status]}
                        >
                          {STATUS_LABEL[entry.result.status]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-base text-gray-900 font-semibold">
                      {entry.result === null ? '—' : entry.result.totalPenalty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- What happened to their class --------------------------------- */}
      {person.classificationHistory.length > 0 && (
        <section className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-xl font-semibold text-gray-800">Classification history</h3>
            <p className="text-gray-600 text-sm mt-1">
              Every change of {isSelf ? 'your' : 'this rider’s'} class, with the day it was
              made.
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {[...person.classificationHistory]
              .reverse()
              .map((change, index) => (
                <li
                  key={`${change.changedAt}-${index}`}
                  className="px-6 py-3 flex flex-wrap items-center gap-3 text-base"
                >
                  <span className="text-gray-500 w-32">{formatDate(change.changedAt)}</span>
                  <ClassificationBadge classification={change.from} fallback="none" />
                  <span className="text-gray-400">→</span>
                  <ClassificationBadge classification={change.to} fallback="none" />
                  {change.changedBy && (
                    <span className="text-sm text-gray-500">by {change.changedBy}</span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default RiderResultsView;
