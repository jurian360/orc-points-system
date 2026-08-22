'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ClassificationBadge from '../../components/ClassificationBadge';
import ParticipantsPanel from '../../components/ParticipantsPanel';
import { crewLabel, CLASSIFICATIONS, type ClassificationValue } from '../../lib/participants';

interface Rally {
  _id: string;
  name: string;
  createdAt: string;
}

interface Stage {
  _id: string;
  name: string;
  createdAt: string;
}

interface StandingsEntry {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  // The two parts of totalPenalty, so the table can show where the points
  // came from: the ORC's (letters), the Tijd (time) and the Diversen (merk)
  // penalty.
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  sheetsSubmitted: number;
  disqualified: boolean;
  rank: number;
}

// The dashboard shows three long lists — the stages, the entry list and the
// standings. Stacked they run to thousands of pixels on a real rally, so they
// are tabs: one list at a time, under a header that keeps the actions (and the
// jump to one EQ's card) in reach from anywhere on the page.
type Tab = 'standings' | 'participants' | 'stages';

export default function RallyDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState<string>('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [standings, setStandings] = useState<StandingsEntry[]>([]);
  const [totalStages, setTotalStages] = useState<number>(0);
  const [participantCount, setParticipantCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set once, when the data is first in: a rally without stages opens on its
  // stages, everything else opens on the standing.
  const [tab, setTab] = useState<Tab | null>(null);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>('');
  const [jumpEq, setJumpEq] = useState('');
  // Forced recalculation of the whole rally, and what it reported last.
  const [rescoring, setRescoring] = useState(false);
  const [rescoreMessage, setRescoreMessage] = useState<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    getParams();
  }, [params]);

  // `showLoading` is off for the refresh after a participant change: the page
  // is already on screen and should not blink back to the loading state.
  const loadData = useCallback(async (showLoading = true) => {
    if (!rallyId) return;
    try {
      if (showLoading) setLoading(true);
      const [rallyRes, stagesRes, standingsRes] = await Promise.all([
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/stages?rallyId=${rallyId}`),
        fetch(`/api/rallies/${rallyId}/standings`),
      ]);

      if (!rallyRes.ok) throw new Error('Failed to fetch rally');
      setRally(await rallyRes.json());

      let stagesData: Stage[] = [];
      if (stagesRes.ok) {
        stagesData = await stagesRes.json();
        setStages(stagesData);
      }

      if (standingsRes.ok) {
        const data = await standingsRes.json();
        setStandings(data.standings || []);
        setTotalStages(data.totalStages || 0);
      }

      setTab((current) => current ?? (stagesData.length === 0 ? 'stages' : 'standings'));
    } catch (err) {
      setError('Failed to load rally. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeleteStage = async (stageId: string) => {
    if (
      !window.confirm(
        'Delete this stage? All answer sheets submitted for it will also be deleted. This cannot be undone.'
      )
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/stages/${stageId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete stage');
      loadData();
    } catch (err) {
      alert('Failed to delete stage. Please try again.');
      console.error(err);
    }
  };

  // Removing a participant from the rally deletes their details and every
  // answer sheet they have in it.
  const handleDeleteParticipant = async (eq: number) => {
    if (
      !window.confirm(
        `Delete participant ${eq} from this rally? Their details and every answer sheet they submitted for it will be deleted. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/rallies/${rallyId}/participants/${eq}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete participant');
      loadData(false);
    } catch (err) {
      alert('Failed to delete participant. Please try again.');
      console.error(err);
    }
  };

  // Re-score every sheet of the rally against the stages as they are now.
  // Editing a stage or a sheet already does this for what it touched; this is
  // the button for everything else — a scoring rule that changed after the
  // cards were typed, or a stage key corrected straight in the database.
  const handleRecalculate = async () => {
    if (
      !window.confirm(
        'Recalculate every score of this rally from the current stage keys? Existing sheets keep their answers and times; only the penalty points are recomputed.'
      )
    ) {
      return;
    }
    setRescoring(true);
    setRescoreMessage(null);
    try {
      const response = await fetch(`/api/rallies/${rallyId}/rescore`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to recalculate scores');
      const data = await response.json();
      const sheets = Number(data.sheets) || 0;
      setRescoreMessage(`Recalculated ${sheets} sheet${sheets === 1 ? '' : 's'}.`);
      await loadData(false);
    } catch (err) {
      setRescoreMessage('Failed to recalculate the scores. Please try again.');
      console.error(err);
    } finally {
      setRescoring(false);
    }
  };

  // The standing is the long one: 50+ crews. Filtering it by EQ, name or class
  // is how an official finds the card they are holding without scrolling.
  const visibleStandings = useMemo(() => {
    const term = search.trim().toLowerCase();
    return standings.filter((entry) => {
      if (classFilter && entry.classification !== classFilter) return false;
      if (!term) return true;
      return (
        String(entry.eq) === term ||
        String(entry.eq).startsWith(term) ||
        crewLabel(entry).toLowerCase().includes(term)
      );
    });
  }, [standings, search, classFilter]);

  const sheetsSubmitted = useMemo(
    () => standings.reduce((total, entry) => total + entry.sheetsSubmitted, 0),
    [standings]
  );

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  // "Which card am I typing?" — one number, straight to that crew's sheets.
  const handleJump = (event: React.FormEvent) => {
    event.preventDefault();
    const eq = Number(jumpEq);
    if (!Number.isInteger(eq) || eq < 1 || eq > 100) return;
    router.push(`/rallies/${rallyId}/participants/${eq}`);
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setSearch('');
    setClassFilter('');
    window.scrollTo({ top: 0 });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading rally...</p>
      </div>
    );
  }

  if (error || !rally) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Rally not found'}</p>
          <Link href="/rallies" className="text-blue-600 hover:underline text-lg">
            Back to Rallies
          </Link>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'standings', label: 'Standings', count: standings.length },
    { id: 'participants', label: 'Participants', count: Math.max(participantCount, standings.length) },
    { id: 'stages', label: 'Stages', count: stages.length },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header and tabs stay on screen: the actions of this rally are reachable
          from the bottom of a 60-row standing without scrolling back up. */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-4 pb-3">
            <div className="min-w-0">
              <Link
                href="/rallies"
                className="text-sm text-gray-500 hover:text-gray-800 hover:underline"
              >
                &larr; Rallies
              </Link>
              <h1 className="text-2xl font-bold text-gray-900 truncate">{rally.name}</h1>
              <p className="text-gray-500 text-sm">
                Created {formatDate(rally.createdAt)} · {stages.length} stage
                {stages.length === 1 ? '' : 's'} · {standings.length} crew
                {standings.length === 1 ? '' : 's'} scored · {sheetsSubmitted} sheet
                {sheetsSubmitted === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={handleJump} className="flex items-center gap-2 mr-1">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={jumpEq}
                  onChange={(event) => setJumpEq(event.target.value)}
                  placeholder="EQ"
                  aria-label="Open the sheets of an EQ number"
                  className="w-20 px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-3 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300"
                  title="Open this participant's sheets"
                >
                  Open EQ
                </button>
              </form>
              <Link
                href={`/time-import?rallyId=${rally._id}`}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium shadow-sm"
              >
                Import Times
              </Link>
              <Link
                href={`/rallies/${rally._id}/answer-sheets`}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium shadow-sm"
              >
                Enter Answer Sheets
              </Link>
            </div>
          </div>

          <nav className="flex gap-1 -mb-px" aria-label="Rally sections">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                onClick={() => switchTab(entry.id)}
                aria-current={tab === entry.id ? 'page' : undefined}
                className={`px-4 py-2.5 text-base font-semibold border-b-2 transition-colors ${
                  tab === entry.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                }`}
              >
                {entry.label}
                <span
                  className={`ml-2 px-2 py-0.5 rounded-full text-sm font-bold ${
                    tab === entry.id ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {entry.count}
                </span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Stages */}
        {tab === 'stages' && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Stages</h2>
                <p className="text-gray-600 text-sm mt-1">
                  In running order — the last one is the stage whose finish disqualifies.
                </p>
              </div>
              <Link
                href={`/rallies/${rally._id}/stages/new`}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium shadow-sm whitespace-nowrap"
              >
                Add Stage
              </Link>
            </div>
            {stages.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-lg text-gray-600 mb-4">
                  No stages yet. Add the first stage and its answer key.
                </p>
                <Link
                  href={`/rallies/${rally._id}/stages/new`}
                  className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 inline-block"
                >
                  Add Stage
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                        Stage
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                        Created At
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {stages.map((stage, index) => (
                      <tr key={stage._id} className="hover:bg-gray-50">
                        <td className="px-6 py-3 whitespace-nowrap">
                          <div className="text-base font-medium text-gray-900">
                            <span className="text-gray-400 mr-2">{index + 1}.</span>
                            {stage.name}
                          </div>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap">
                          <div className="text-sm text-gray-600">{formatDate(stage.createdAt)}</div>
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-right">
                          <div className="flex justify-end space-x-4">
                            <Link
                              href={`/rallies/${rally._id}/stages/${stage._id}`}
                              className="text-blue-600 hover:text-blue-900 font-medium text-base"
                            >
                              View
                            </Link>
                            <Link
                              href={`/rallies/${rally._id}/stages/${stage._id}/edit`}
                              className="text-indigo-600 hover:text-indigo-900 font-medium text-base"
                            >
                              Edit
                            </Link>
                            <Link
                              href={`/time-import?rallyId=${rally._id}&stageId=${stage._id}`}
                              className="text-emerald-700 hover:text-emerald-900 font-medium text-base"
                            >
                              Import Times
                            </Link>
                            <button
                              onClick={() => handleDeleteStage(stage._id)}
                              className="text-red-600 hover:text-red-900 font-medium text-base"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Participants */}
        {tab === 'participants' && (
          <ParticipantsPanel
            rallyId={rally._id}
            sheetEqs={standings.map((entry) => entry.eq)}
            onChanged={() => loadData(false)}
            onCountChange={setParticipantCount}
          />
        )}

        {/* Standings */}
        {tab === 'standings' && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap justify-between items-end gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Standings</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Total penalty points (ORC&apos;s + Tijd + Diversen) over every sheet — lowest
                  wins. A
                  disqualified participant is ranked behind everyone still in the rally. Editing a
                  stage key or a sheet re-scores what it touches; Recalculate Scores redoes the
                  whole rally.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRecalculate}
                  disabled={rescoring}
                  title="Re-score every sheet of this rally against the stage keys as they are now"
                  className="px-4 py-2 bg-amber-100 text-amber-800 border border-amber-300 rounded-md hover:bg-amber-200 font-medium disabled:opacity-60"
                >
                  {rescoring ? 'Recalculating…' : 'Recalculate Scores'}
                </button>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search EQ or crew"
                  aria-label="Search the standings"
                  className="px-3 py-2 border border-gray-300 rounded-md text-base w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select
                  value={classFilter}
                  onChange={(event) => setClassFilter(event.target.value)}
                  aria-label="Filter by classification"
                  className="px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All classes</option>
                  {CLASSIFICATIONS.map((value) => (
                    <option key={value} value={value}>
                      Class {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {rescoreMessage && (
              <p className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-sm font-medium text-amber-900">
                {rescoreMessage}
              </p>
            )}
            {standings.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-lg text-gray-600">
                  No answer sheets submitted yet. Standings will appear once participants have
                  sheets.
                </p>
              </div>
            ) : visibleStandings.length === 0 ? (
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
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {visibleStandings.map((entry) => (
                      <tr
                        key={entry.eq}
                        className={
                          entry.disqualified
                            ? 'bg-red-50'
                            : entry.rank === 1
                              ? 'bg-yellow-50'
                              : 'hover:bg-gray-50'
                        }
                      >
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className="text-base font-bold text-gray-900">
                            {entry.rank}
                            {entry.rank === 1 && !entry.disqualified && (
                              <span className="ml-2" title="Winner">🏆</span>
                            )}
                            {entry.disqualified && (
                              <span
                                className="ml-2 px-2 py-0.5 rounded bg-red-100 text-red-800 text-sm font-bold"
                                title="Outside the finish window of the last stage"
                              >
                                DQ
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <Link
                            href={`/rallies/${rally._id}/participants/${entry.eq}`}
                            className="text-base font-bold text-blue-600 hover:underline"
                          >
                            {entry.eq}
                          </Link>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <ClassificationBadge classification={entry.classification} />
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-base text-gray-800">
                            {crewLabel(entry) || <span className="text-gray-400">—</span>}
                          </span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className="text-base text-gray-600">
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
                        <td className="px-4 py-2 whitespace-nowrap text-right">
                          <div className="flex justify-end space-x-4">
                            <Link
                              href={`/rallies/${rally._id}/participants/${entry.eq}`}
                              className="text-blue-600 hover:text-blue-900 font-medium text-base"
                            >
                              Sheets
                            </Link>
                            <button
                              onClick={() => handleDeleteParticipant(entry.eq)}
                              className="text-red-600 hover:text-red-900 font-medium text-base"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
