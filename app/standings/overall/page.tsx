'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ClassificationBadge from '../../components/ClassificationBadge';
import { useAuth } from '../../components/AuthContext';
import { PAGE_CONTAINER } from '../../lib/layout';
import { classStandings, type CrewSeasonEntry } from '../../lib/overallStandings';
import { MAIN_CLASSIFICATIONS } from '../../lib/participants';
import { ALL_RESULTS, countingRuleLabel, type SeasonSettings } from '../../lib/seasons';
import { STATUS_LABEL } from '../../lib/standings';
import type { OverallStandingsResponse } from '../../types';

// The overall standings of one rally year: who won the season.
//
// A season is won by a **crew** — the same two people turning up together
// often enough to have ridden the year. So every line here is a pair, not an
// EQ number: the numbers are handed out fresh each rally, and one rider can be
// in two crews in a year and be placed in both.
//
// The page scores nothing and adds nothing up. Every total comes from
// `/api/standings/overall`, which reads each rally's own standings — the same
// numbers on that rally's table and on its printed result sheet.
type View = 'all' | 'B' | 'A' | 'H';

export default function OverallStandingsPage() {
  const { can } = useAuth();
  const mayConfigure = can('manage:rally');

  const [data, setData] = useState<OverallStandingsResponse | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [view, setView] = useState<View>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The settings form, open only for an admin. Held apart from `data` so a
  // half-typed number does not re-rank the table underneath it.
  const [editingSettings, setEditingSettings] = useState(false);
  const [draft, setDraft] = useState<SeasonSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (requested: number | null) => {
    setError(null);
    try {
      const response = await fetch(
        requested === null ? '/api/standings/overall' : `/api/standings/overall?year=${requested}`
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(payload.error || 'Could not load the overall standings.');
        return;
      }

      setData(payload);
      setYear(payload.year);
    } catch {
      setError('Could not load the overall standings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  // A class rides against its own class, so a class sheet re-ranks what it
  // filters rather than showing the overall places with gaps in them — the
  // same rule the printed rally result sheet follows.
  const entries: CrewSeasonEntry[] = useMemo(() => {
    if (!data) return [];
    return view === 'all' ? data.entries : classStandings(data.entries, view);
  }, [data, view]);

  const placed = entries.filter((entry) => entry.eligible).length;

  const handleSaveSettings = async () => {
    if (!draft || year === null) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/seasons/${year}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countingResults: draft.countingResults,
          minimumRallies: draft.minimumRallies,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not save the season');

      setEditingSettings(false);
      // Re-read rather than patch: both numbers re-rank the whole table.
      await load(year);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the season.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className={PAGE_CONTAINER}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Overall standings</h1>
            {data && (
              <p className="text-gray-600 text-base mt-1 max-w-4xl">
                {countingRuleLabel(data.settings)} A crew is two riders, whichever seat each
                of them took — swapping seats between rallies is the same crew.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <select
              value={year ?? ''}
              onChange={(e) => {
                setLoading(true);
                void load(Number(e.target.value));
              }}
              aria-label="Season"
              className="px-3 py-2 border border-gray-300 rounded-md text-base"
            >
              {(data?.years ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            {mayConfigure && data && (
              <button
                onClick={() => {
                  setDraft(data.settings);
                  setEditingSettings((open) => !open);
                }}
                className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium text-base"
              >
                {editingSettings ? 'Close' : 'Season rules'}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-base text-red-700">
            {error}
          </div>
        )}

        {editingSettings && draft && (
          <section className="bg-white rounded-xl shadow p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Rules for {year}</h2>
            <p className="text-gray-600 text-base mb-4 max-w-3xl">
              These two numbers decide who is champion, so they are an admin&apos;s. They apply
              to this year only — a season nobody has configured uses the club&apos;s standard
              rules.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <label
                  htmlFor="counting-results"
                  className="block text-sm font-semibold mb-1 text-gray-800"
                >
                  Results that count
                </label>
                <input
                  type="number"
                  id="counting-results"
                  min={0}
                  max={50}
                  className="w-full p-2 border-2 border-gray-300 rounded-lg text-base text-gray-700"
                  value={draft.countingResults}
                  onChange={(e) =>
                    setDraft({ ...draft, countingResults: Number(e.target.value) })
                  }
                />
                <p className="text-gray-600 text-sm mt-1">
                  A crew&apos;s best <em>n</em> rallies are added up. {ALL_RESULTS} counts every
                  rally they rode, which is the club&apos;s usual.
                </p>
              </div>

              <div>
                <label
                  htmlFor="minimum-rallies"
                  className="block text-sm font-semibold mb-1 text-gray-800"
                >
                  Rallies needed to be placed
                </label>
                <input
                  type="number"
                  id="minimum-rallies"
                  min={1}
                  max={50}
                  className="w-full p-2 border-2 border-gray-300 rounded-lg text-base text-gray-700"
                  value={draft.minimumRallies}
                  onChange={(e) =>
                    setDraft({ ...draft, minimumRallies: Number(e.target.value) })
                  }
                />
                <p className="text-gray-600 text-sm mt-1">
                  How many official rallies the same two riders have to have ridden together.
                </p>
              </div>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="mt-4 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-base disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save rules'}
            </button>
          </section>
        )}

        {/* The rallies the season is read off. Shown because a reader who
            counted eight rallies and sees six should be told which two were
            unofficial, not left to wonder. */}
        {data && (
          <div className="bg-white rounded-lg shadow p-4 mb-4 text-base text-gray-700">
            <span className="font-semibold">{data.rallies.length}</span> official{' '}
            {data.rallies.length === 1 ? 'rally' : 'rallies'} in {data.year}
            {data.rallies.length > 0 && (
              <span className="text-gray-500">
                {' '}
                — {data.rallies.map((rally) => rally.name).join(', ')}
              </span>
            )}
            {data.unofficialRallies > 0 && (
              <span className="block text-gray-500 mt-1">
                {data.unofficialRallies} unofficial{' '}
                {data.unofficialRallies === 1 ? 'rit is' : 'ritten are'} left out of this
                ranking.
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {(['all', ...MAIN_CLASSIFICATIONS] as View[]).map((option) => (
            <button
              key={option}
              onClick={() => setView(option)}
              className={`px-4 py-2 rounded-md font-medium text-base ${
                view === option
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              {option === 'all' ? 'All classes' : `Class ${option}`}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-lg text-gray-600">Loading the season…</p>
          ) : entries.length === 0 ? (
            <p className="p-8 text-center text-lg text-gray-600">
              No registered crew has ridden an official rally in this season yet. A crew counts
              once both of its riders are registered on the entry — an entry with only names
              is scored in its own rally but is not a crew.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      #
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Crew
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Kl.
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Rallies
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Counted
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Strafpunten
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                      Season
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {entries.map((entry) => (
                    <tr
                      key={entry.crewKey}
                      className={entry.eligible ? 'hover:bg-gray-50' : 'bg-gray-50 text-gray-600'}
                    >
                      <td className="px-4 py-2 text-base font-bold text-gray-900 whitespace-nowrap">
                        {entry.eligible ? (
                          entry.rank
                        ) : (
                          // A crew short of the minimum has no place — they
                          // are listed so they can see how far off they are,
                          // not ranked last.
                          <span
                            className="text-amber-700 text-sm font-semibold"
                            title={`Needs ${
                              (data?.settings.minimumRallies ?? 3) - entry.ralliesRidden
                            } more rally with the same partner`}
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-base text-gray-900">
                        <span className="font-medium">{entry.label}</span>
                        <span className="block text-sm text-gray-500">
                          {entry.members
                            .map((member) => member.email)
                            .join(' · ')}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <ClassificationBadge classification={entry.classification} />
                      </td>
                      <td className="px-4 py-2 text-base text-right text-gray-800">
                        {entry.ralliesRidden}
                      </td>
                      <td className="px-4 py-2 text-base text-right text-gray-800">
                        {entry.countedResults}
                      </td>
                      <td className="px-4 py-2 text-base text-right font-bold text-gray-900">
                        {entry.eligible ? entry.totalPenalty : '—'}
                      </td>
                      {/* Every rally this crew rode, counted or not. A result
                          the counting rule dropped is shown greyed rather
                          than hidden: an official reading the sheet wants to
                          see what was left out. */}
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {entry.results.map((result) => (
                            <span
                              key={result.rallyId}
                              title={`${result.rallyName} — EQ ${result.eq}${
                                result.counted ? '' : ' (not counted)'
                              }`}
                              className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-medium ${
                                result.counted
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-400 line-through'
                              }`}
                            >
                              {STATUS_LABEL[result.status] || result.totalPenalty}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && entries.length > 0 && (
          <p className="mt-4 text-base text-gray-600">
            {placed} crew{placed === 1 ? '' : 's'} placed
            {entries.length - placed > 0 &&
              `, ${entries.length - placed} short of the ${
                data?.settings.minimumRallies ?? 3
              } rallies needed`}
            . <Link href="/persons" className="text-blue-600 hover:underline">
              Riders
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
