'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ParticipantsPanel from '../../components/ParticipantsPanel';
import RallyTimesPanel from '../../components/RallyTimesPanel';
import RouteManagerPanel, { type ManagedRoute } from '../../components/RouteManagerPanel';
import StandingsTable, { type StandingsTableEntry } from '../../components/StandingsTable';
import { useAuth } from '../../components/AuthContext';
import { crewLabel, CLASSIFICATIONS } from '../../lib/participants';
import { copyRallyName } from '../../lib/rallyCodes';
import { PAGE_CONTAINER } from '../../lib/pageContainer';
import { groupStagesByRoute } from '../../lib/routes';
import { downloadRally, getOfflineRally } from '../../lib/offline/store';

interface Rally {
  _id: string;
  name: string;
  // The rally's public code, shown to the crews and printed under every QR
  // code. Missing on a rally created before codes existed.
  code?: string;
  createdAt: string;
}

interface Stage {
  _id: string;
  name: string;
  // The route (leg) this stage is ridden in, so the list can group by leg. Null
  // on a rally with no routes, which is most of them.
  routeId?: string | null;
  createdAt: string;
}

type StandingsEntry = StandingsTableEntry;

// The dashboard shows four long lists — the stages, the standings, the entry
// list and the WPT overview. Stacked they run to thousands of pixels on a real
// rally, so they are tabs: one list at a time, under a header that keeps the
// actions (and the jump to one EQ's card) in reach from anywhere on the page.
type Tab = 'stages' | 'standings' | 'participants' | 'times';

export default function RallyDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  // Setting the rally up — its stages and keys, the entry list, the imports,
  // the QR codes, the on-demand re-score — is an admin's. A data-entry official
  // reads this page and types cards from it, so what stays visible is View,
  // Enter Answer Sheets and the standings.
  const { can } = useAuth();
  const isAdmin = can('manage:rally');
  const [rallyId, setRallyId] = useState<string>('');
  const [rally, setRally] = useState<Rally | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  // The rally's legs, in the order they are ridden. Empty on a rally with no
  // routes, and then everything below reads exactly as it did before routes
  // existed — that is the gate, not a flag.
  const [routes, setRoutes] = useState<ManagedRoute[]>([]);
  const [unassignedStages, setUnassignedStages] = useState(0);
  const [managingRoutes, setManagingRoutes] = useState(false);
  const [standings, setStandings] = useState<StandingsEntry[]>([]);
  const [totalStages, setTotalStages] = useState<number>(0);
  const [participantCount, setParticipantCount] = useState<number>(0);
  // Filled in by the times tab the first time it is opened; until then the tab
  // is labelled with the stages the overview will hold, which is the same number.
  const [timesStageCount, setTimesStageCount] = useState<number>(0);
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
  const [duplicating, setDuplicating] = useState(false);
  // The copy of this rally kept on this device for the offline workspace
  // (app/offline): when it was downloaded, or null when there is none.
  const [offlineCopyAt, setOfflineCopyAt] = useState<string | null>(null);
  const [downloadingOffline, setDownloadingOffline] = useState(false);
  const [offlineMessage, setOfflineMessage] = useState<string | null>(null);

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
      const [rallyRes, stagesRes, standingsRes, routesRes] = await Promise.all([
        fetch(`/api/rallies/${rallyId}`),
        fetch(`/api/stages?rallyId=${rallyId}`),
        fetch(`/api/rallies/${rallyId}/standings`),
        fetch(`/api/rallies/${rallyId}/routes`),
      ]);

      if (!rallyRes.ok) throw new Error('Failed to fetch rally');
      setRally(await rallyRes.json());

      let stagesData: Stage[] = [];
      if (stagesRes.ok) {
        stagesData = await stagesRes.json();
        setStages(stagesData);
      }

      if (routesRes.ok) {
        const data = await routesRes.json();
        setRoutes(data.routes || []);
        setUnassignedStages(data.unassignedStages || 0);
      }

      if (standingsRes.ok) {
        const data = await standingsRes.json();
        setStandings(data.standings || []);
        setTotalStages(data.totalStages || 0);
      }

      setTab((current) => current ?? 'stages');
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

  // A new rally with the stages and the answer keys of this one. The setup is
  // what an event repeats; the entry list, the answer sheets and the printed QR
  // codes belong to this running of it and are left behind.
  const handleDuplicate = async () => {
    if (!rally) return;
    const name = copyRallyName(rally.name);
    if (
      !window.confirm(
        `Duplicate this rally as "${name}"? Its stages and their answer keys are copied. ` +
          'The participants, their answer sheets and the printed QR codes are not.'
      )
    ) {
      return;
    }

    setDuplicating(true);
    try {
      const response = await fetch(`/api/rallies/${rally._id}/duplicate`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to duplicate rally');
      }
      const data = await response.json();
      // Straight into the copy: what an official does next is check its keys
      // and import the entry list of the new event.
      router.push(`/rallies/${data.rally._id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to duplicate rally. Please try again.');
      console.error(err);
      setDuplicating(false);
    }
  };

  useEffect(() => {
    if (!rallyId) return;
    getOfflineRally(rallyId)
      .then((copy) => setOfflineCopyAt(copy?.downloadedAt ?? null))
      .catch(() => setOfflineCopyAt(null));
  }, [rallyId]);

  // Every official can take a rally into the field: the copy holds what a
  // data-entry account reads anyway, and what comes back is answer sheets.
  const handleDownloadOffline = async () => {
    setDownloadingOffline(true);
    setOfflineMessage(null);
    try {
      const copy = await downloadRally(rallyId);
      setOfflineCopyAt(copy.downloadedAt);
      setOfflineMessage(
        'Downloaded to this device. Open it under Offline in the menu — that works without a connection too.'
      );
    } catch (err) {
      setOfflineMessage(
        err instanceof Error ? err.message : 'Failed to download the rally. Please try again.'
      );
    } finally {
      setDownloadingOffline(false);
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

  // The crews with a card in this rally. The standings also list the ones who
  // did not start, and a DNS has nothing scored to count.
  // The rally's legs with their stages. **Empty on a rally with no routes**, and
  // the list below then renders the flat table it always rendered rather than a
  // group of one.
  const routeGroups = useMemo(() => groupStagesByRoute(stages, routes), [stages, routes]);

  const crewsScored = useMemo(
    () => standings.filter((entry) => entry.sheetsSubmitted > 0).length,
    [standings]
  );

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
    { id: 'stages', label: 'Stages', count: stages.length },
    { id: 'standings', label: 'Standings', count: standings.length },
    { id: 'participants', label: 'Participants', count: Math.max(participantCount, standings.length) },
    { id: 'times', label: 'Times', count: Math.max(timesStageCount, stages.length) },
  ];

  // One row of the stage list. Extracted so the flat list and the per-route
  // grouping below render exactly the same row.
  const renderStageRow = (stage: Stage, number: number) => (
            <tr key={stage._id} className="hover:bg-gray-50">
              <td className="px-6 py-3 whitespace-nowrap">
                <div className="text-base font-medium text-gray-900">
                  <span className="text-gray-400 mr-2">{number}.</span>
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
                  {isAdmin && (
                    <>
                      <Link
                        href={`/rallies/${rally._id}/stages/${stage._id}/edit`}
                        className="text-indigo-600 hover:text-indigo-900 font-medium text-base"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/rallies/${rally._id}/stages/${stage._id}/qr-codes`}
                        className="text-green-700 hover:text-green-900 font-medium text-base"
                      >
                        QR Codes
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
                    </>
                  )}
                </div>
              </td>
            </tr>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header and tabs stay on screen: the actions of this rally are reachable
          from the bottom of a 60-row standing without scrolling back up.
          The bar bleeds to the window, its content sits in `PAGE_CONTAINER` —
          the same width every panel below it uses, so switching a tab moves
          nothing but the list underneath. */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className={PAGE_CONTAINER}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-4 pb-3">
            <div className="min-w-0">
              <Link
                href="/rallies"
                className="text-sm text-gray-500 hover:text-gray-800 hover:underline"
              >
                &larr; Rallies
              </Link>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-2xl font-bold text-gray-900 truncate">{rally.name}</h1>
                {/* The code the crews and their app see, so an official does not
                    have to open a QR page to find out what it is. */}
                {rally.code && (
                  <span
                    className="font-mono text-base font-semibold tracking-wider text-gray-600 bg-gray-100 border border-gray-200 rounded px-2 py-0.5"
                    title="The rally code the crews see in the control-card app"
                  >
                    {rally.code}
                  </span>
                )}
              </div>
              <p className="text-gray-500 text-sm">
                Created {formatDate(rally.createdAt)} ·{' '}
                {routes.length > 0 ? `${routes.length} routes · ` : ''}
                {stages.length} stage
                {stages.length === 1 ? '' : 's'} · {crewsScored} crew
                {crewsScored === 1 ? '' : 's'} scored · {sheetsSubmitted} sheet
                {sheetsSubmitted === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Quick jump — read-only, so it stands apart from the actions
                  that change the rally. */}
              <form onSubmit={handleJump} className="flex items-center gap-2">
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

              {isAdmin && (
                <>
                  {/* Rally-wide setup and maintenance actions, grouped together
                      and set off from the quick jump and the two actions an
                      official reaches for constantly (Import Times, Enter
                      Answer Sheets) below. */}
                  <span className="hidden sm:block w-px h-8 bg-gray-200 mx-1" aria-hidden="true" />
                  <Link
                    href={`/rallies/${rally._id}/edit`}
                    className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300"
                    title="Change the name or the code of this rally"
                  >
                    Edit Rally
                  </Link>
                  <button
                    onClick={handleDuplicate}
                    disabled={duplicating}
                    title="Create a new rally with the stages and answer keys of this one"
                    className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300 disabled:opacity-60"
                  >
                    {duplicating ? 'Duplicating…' : 'Duplicate'}
                  </button>
                  <button
                    onClick={handleRecalculate}
                    disabled={rescoring}
                    title="Re-score every sheet of this rally against the stage keys as they are now"
                    className="px-4 py-2 bg-amber-100 text-amber-800 border border-amber-300 rounded-md hover:bg-amber-200 font-medium disabled:opacity-60"
                  >
                    {rescoring ? 'Recalculating…' : 'Recalculate Scores'}
                  </button>
                  <Link
                    href={`/rallies/${rally._id}/public-results`}
                    title="Let anyone with the link, or a printed QR code, read this rally's standings with no account"
                    className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300"
                  >
                    Public Results
                  </Link>
                </>
              )}

              <span className="hidden sm:block w-px h-8 bg-gray-200 mx-1" aria-hidden="true" />

              {isAdmin && (
                <Link
                  href={`/time-import?rallyId=${rally._id}`}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium shadow-sm"
                >
                  Import Times
                </Link>
              )}
              <button
                onClick={handleDownloadOffline}
                disabled={downloadingOffline}
                title={
                  offlineCopyAt
                    ? `On this device since ${formatDate(offlineCopyAt)} — download it again to bring it up to date`
                    : 'Keep a copy on this device to type cards and read the standings without a connection'
                }
                className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300 disabled:opacity-60"
              >
                {downloadingOffline
                  ? 'Downloading…'
                  : offlineCopyAt
                    ? 'Update Offline Copy'
                    : 'Make Available Offline'}
              </button>
              <Link
                href={`/rallies/${rally._id}/answer-sheets`}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium shadow-sm"
              >
                Enter Answer Sheets
              </Link>
            </div>
          </div>

          {/* The four tabs do not fit one row at phone width; rather than wrap
              (which would push the panel below down an unpredictable amount
              as an official switches tabs) or clip, this scrolls sideways
              inside itself — the same pattern the wide grids below use, and
              the reason the page itself is not allowed to (see globals.css). */}
          <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Rally sections">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                onClick={() => switchTab(entry.id)}
                aria-current={tab === entry.id ? 'page' : undefined}
                className={`flex-shrink-0 whitespace-nowrap px-4 py-2.5 text-base font-semibold border-b-2 transition-colors ${
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

      <div className={`${PAGE_CONTAINER} py-6`}>
        {/* Feedback from a rally-wide action (Recalculate Scores) — shown above
            whichever tab is open, since a recalculation touches all of them. */}
        {offlineMessage && (
          <p className="mb-4 px-4 py-2 bg-blue-50 border border-blue-200 rounded-md text-sm font-medium text-blue-900">
            {offlineMessage}{' '}
            {offlineCopyAt && (
              <Link href={`/offline?rally=${rally._id}`} className="underline">
                Open the offline workspace
              </Link>
            )}
          </p>
        )}

        {rescoreMessage && (
          <p className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm font-medium text-amber-900">
            {rescoreMessage}
          </p>
        )}

        {/* Stages */}
        {tab === 'stages' && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Stages</h2>
                <p className="text-gray-600 text-sm mt-1">
                  {routes.length > 0
                    ? 'In running order, by route — the last stage of the last route is the one whose finish disqualifies.'
                    : 'In running order — the last one is the stage whose finish disqualifies.'}
                </p>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap gap-3">
                  {/* The routes of the rally, managed under the list they group.
                      Admin-only in the UI, and every route it calls is guarded
                      as well — hiding a button is never the control. */}
                  <button
                    onClick={() => setManagingRoutes((current) => !current)}
                    className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-md hover:bg-indigo-200 font-medium whitespace-nowrap transition-colors"
                  >
                    {managingRoutes ? 'Close Routes' : `Routes${routes.length > 0 ? ` (${routes.length})` : ''}`}
                  </button>
                  <Link
                    href={`/rallies/${rally._id}/stages/new`}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium shadow-sm whitespace-nowrap"
                  >
                    Add Stage
                  </Link>
                </div>
              )}
            </div>
            {isAdmin && managingRoutes && (
              <div className="px-6 pt-5">
                <RouteManagerPanel
                  rallyId={rally._id}
                  routes={routes}
                  unassignedStages={unassignedStages}
                  onChanged={() => loadData(false)}
                  onClose={() => setManagingRoutes(false)}
                />
              </div>
            )}

            {stages.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-lg text-gray-600 mb-4">
                  {isAdmin
                    ? 'No stages yet. Add the first stage and its answer key.'
                    : 'No stages yet. An admin adds the stages and their answer keys.'}
                </p>
                {isAdmin && (
                  <Link
                    href={`/rallies/${rally._id}/stages/new`}
                    className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 inline-block"
                  >
                    Add Stage
                  </Link>
                )}
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
                    {routeGroups.length === 0
                      ? stages.map((stage, index) => renderStageRow(stage, index + 1))
                      : routeGroups.flatMap((group) => [
                          // A heading per leg, and the stages numbered inside
                          // it: on a rally ridden in legs, "stage 2" means the
                          // second stage of its route.
                          <tr key={`route-${group.position}`} className="bg-indigo-50">
                            <td colSpan={3} className="px-6 py-2">
                              <span className="text-sm font-bold uppercase tracking-wide text-indigo-900">
                                <span className="text-indigo-400 mr-2">{group.position}.</span>
                                {group.route ? group.route.name : 'Zonder route'}
                              </span>
                              <span className="text-xs text-gray-600 ml-3">
                                {group.stages.length} stage
                                {group.stages.length === 1 ? '' : 's'}
                                {group.isLast
                                  ? ' — the last one is the stage whose finish disqualifies'
                                  : ' — the delta starts again at the next route'}
                              </span>
                              {group.route && (
                                <Link
                                  href={`/rallies/${rally._id}/standings/print?route=${group.route._id}`}
                                  className="text-xs text-blue-600 hover:underline ml-3"
                                >
                                  Print klassement
                                </Link>
                              )}
                            </td>
                          </tr>,
                          ...group.stages.map((stage, index) =>
                            renderStageRow(stage, index + 1)
                          ),
                        ])}
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
            readOnly={!isAdmin}
          />
        )}

        {/* Times — the WPT of every control of every stage */}
        {tab === 'times' && (
          <RallyTimesPanel rallyId={rally._id} onStageCountChange={setTimesStageCount} />
        )}

        {/* Standings */}
        {tab === 'standings' && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap justify-between items-end gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">Standings</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Total penalty points (ORC&apos;s + Tijd + Diversen) over every sheet — lowest
                  wins. A stage a crew has no sheet for is scored as a blank card. A
                  crew with no card for the last stage, or outside its finish window, is a DNF;
                  a crew with no card at all is a DNS. Both are ranked behind the field. Editing
                  a stage key or a sheet re-scores what it touches; Recalculate Scores redoes the
                  whole rally.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
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
                {/* The results on A4. The button prints what is on screen:
                    the whole field as one algemeen klassement, or the class the
                    standings are filtered on. The print page itself also offers
                    a sheet per class, each ranked within its own class. */}
                <Link
                  href={`/rallies/${rally._id}/standings/print?${
                    classFilter ? `class=${classFilter}` : 'view=combined'
                  }`}
                  className="px-4 py-2 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 font-medium text-base transition-colors"
                >
                  Print
                </Link>
              </div>
            </div>
            <StandingsTable
              entries={visibleStandings}
              hasStandings={standings.length > 0}
              totalStages={totalStages}
              eqHref={(eq) => `/rallies/${rally._id}/participants/${eq}`}
              renderActions={(entry) => (
                <>
                  <Link
                    href={`/rallies/${rally._id}/participants/${entry.eq}`}
                    className="text-blue-600 hover:text-blue-900 font-medium text-base"
                  >
                    Sheets
                  </Link>
                  {isAdmin && (
                    <button
                      onClick={() => handleDeleteParticipant(entry.eq)}
                      className="text-red-600 hover:text-red-900 font-medium text-base"
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}
