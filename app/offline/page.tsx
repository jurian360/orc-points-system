'use client';

// The offline workspace — see "Offline mode" in CLAUDE.md.
//
// Officials sometimes work where there is no connection. A rally downloaded on
// its dashboard (Make Available Offline) is held in this browser's IndexedDB
// (app/lib/offline/store.ts), and this page works on that copy: type and
// correct cards, import a control's times, read the standings and print them.
// Everything is scored here with the modules the server scores with, and the
// cards changed here are uploaded once there is a connection again.
//
// It is **one static page** on purpose. Every other page of the app is a
// dynamic route whose HTML carries its own ids, which a service worker cannot
// serve for an id it never cached — and a card typed here has no server id at
// all. This page has no params, so it is prerendered, cached whole by the
// service worker (public/sw.js), and does its own navigation between tabs. It
// is a public path in middleware.ts: it holds no data of its own, and the
// session — 24 hours from login — may run out during a long day in the field.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import OfflineCards from '../components/offline/OfflineCards';
import OfflineSyncPanel from '../components/offline/OfflineSyncPanel';
import StandingsTable from '../components/StandingsTable';
import StandingsPrintView from '../components/StandingsPrintView';
import TimeImportWizard, { type TimeImportSource } from '../components/TimeImportWizard';
import { CLASSIFICATIONS, crewLabel } from '../lib/participants';
import { PAGE_CONTAINER } from '../lib/pageContainer';
import { can } from '../lib/roles';
import {
  applyTimeImport,
  downloadRally,
  getOfflineRally,
  getOfflineSheets,
  listOfflineRallies,
  OFFLINE_CHANGE_EVENT,
  removeOfflineRally,
  scoreOfflineRally,
  type OfflineRally,
  type OfflineSheet,
} from '../lib/offline/store';

type Tab = 'cards' | 'standings' | 'print' | 'times' | 'upload';

type RallySummary = Awaited<ReturnType<typeof listOfflineRallies>>[number];

const formatDate = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export default function OfflineWorkspacePage() {
  const online = useOnline();
  const [rallies, setRallies] = useState<RallySummary[] | null>(null);
  const [rallyId, setRallyId] = useState<string>('');
  const [rally, setRally] = useState<OfflineRally | null>(null);
  const [records, setRecords] = useState<OfflineSheet[]>([]);
  // The rally id `rally` and `records` were read for, so a rally that is still
  // being read is not reported as missing.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('cards');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');

  // `?rally=<id>` opens that rally — the link the dashboard offers after a
  // download. Read once; the page is static and has no params of its own.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('rally');
    if (requested) setRallyId(requested);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [list, copy, sheets] = await Promise.all([
        listOfflineRallies(),
        rallyId ? getOfflineRally(rallyId) : Promise.resolve(undefined),
        rallyId ? getOfflineSheets(rallyId) : Promise.resolve([] as OfflineSheet[]),
      ]);
      setRallies(list);
      setRally(copy || null);
      setRecords(sheets);
      setLoadedFor(rallyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This browser cannot store data for offline use.');
      setRallies([]);
    }
  }, [rallyId]);

  // Re-read after every change — including the uploads the navigation runs on
  // its own when the connection comes back.
  useEffect(() => {
    reload();
    window.addEventListener(OFFLINE_CHANGE_EVENT, reload);
    return () => window.removeEventListener(OFFLINE_CHANGE_EVENT, reload);
  }, [reload]);

  const openRally = (id: string) => {
    setRallyId(id);
    setTab('cards');
    setSearch('');
    setClassFilter('');
    setError(null);
    window.history.replaceState(null, '', id ? `/offline?rally=${id}` : '/offline');
  };

  // Scored and ranked on this device, with the functions the server uses.
  const computed = useMemo(
    () => (rally ? scoreOfflineRally(rally, records) : null),
    [rally, records]
  );

  const visibleStandings = useMemo(() => {
    const entries = computed?.standings.standings || [];
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (classFilter && entry.classification !== classFilter) return false;
      if (!term) return true;
      return String(entry.eq).startsWith(term) || crewLabel(entry).toLowerCase().includes(term);
    });
  }, [computed, search, classFilter]);

  // The time-import wizard, reading and writing the copy on this device.
  const timeSource = useMemo<TimeImportSource | null>(() => {
    if (!rally) return null;
    return {
      offline: true,
      loadRallies: async () => [
        { _id: rally.rallyId, name: rally.rally.name, code: rally.rally.code, createdAt: '' },
      ],
      loadRally: async () => ({
        stages: rally.stages,
        participants: rally.participants,
        routes: rally.routes,
      }),
      loadStageSheetEqs: async (stageId) =>
        (await getOfflineSheets(rally.rallyId))
          .filter((record) => record.stageId === stageId && !record.deleted)
          .map((record) => record.eq),
      importTimes: (stageId, body) =>
        applyTimeImport(rally.rallyId, stageId, body.rowNumber, body.times, body.createMissingSheets),
    };
  }, [rally]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed.`);
    } finally {
      setBusy(null);
      reload();
    }
  };

  const handleRemove = (summary: RallySummary) => {
    const warning =
      summary.pending > 0
        ? `${summary.pending} card${summary.pending === 1 ? ' is' : 's are'} not uploaded yet and will be lost. Remove "${summary.rally.name}" from this device anyway?`
        : `Remove "${summary.rally.name}" from this device? It stays on the server.`;
    if (!window.confirm(warning)) return;
    run('Removing', () => removeOfflineRally(summary.rallyId));
  };

  const connection = (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-semibold ${
        online ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-800'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-600' : 'bg-gray-500'}`} />
      {online ? 'Online' : 'No connection'}
    </span>
  );

  const errorBanner = error && (
    <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded mb-4 font-medium print:hidden">
      {error}
    </div>
  );

  // --- the rallies on this device ------------------------------------------

  const missing = Boolean(rallyId) && loadedFor === rallyId && !rally;

  if (!rallyId || missing) {
    return (
      <div className="min-h-screen bg-gray-50 py-6">
        <div className={PAGE_CONTAINER}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h1 className="text-2xl font-bold text-gray-900">Offline</h1>
            {connection}
          </div>
          <p className="text-gray-700 mb-6">
            Rallies kept on this device to work on without a connection: type and correct
            cards, import a control&apos;s times, read and print the standings. Changes are
            uploaded as soon as there is a connection again. To add a rally, open it while online
            and choose <span className="font-semibold">Make Available Offline</span>.
          </p>
          {errorBanner}
          {missing && (
            <p className="mb-4 text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
              That rally is not on this device.
            </p>
          )}

          {rallies === null ? (
            <p className="text-gray-600">Loading…</p>
          ) : rallies.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-lg text-gray-700 mb-4">No rally has been downloaded to this device yet.</p>
              {online && (
                <Link href="/rallies" className="text-blue-600 hover:underline font-medium">
                  Go to the rallies &rarr;
                </Link>
              )}
            </div>
          ) : (
            <div className="grid gap-3">
              {rallies.map((summary) => (
                <div
                  key={summary.rallyId}
                  className="bg-white rounded-lg shadow p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h2 className="text-lg font-bold text-gray-900">{summary.rally.name}</h2>
                      {summary.rally.code && (
                        <span className="font-mono text-sm text-gray-600">{summary.rally.code}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      Downloaded {formatDate(summary.downloadedAt)} · {summary.stages.length} stage
                      {summary.stages.length === 1 ? '' : 's'} · {summary.participants.length} crews
                      {summary.pending > 0 && (
                        <span className="ml-2 font-semibold text-amber-700">
                          {summary.pending} to upload
                        </span>
                      )}
                      {summary.conflicts > 0 && (
                        <span className="ml-2 font-semibold text-red-700">
                          {summary.conflicts} in conflict
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => openRally(summary.rallyId)}
                      className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium shadow-sm"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => run('Updating', () => downloadRally(summary.rallyId))}
                      disabled={!online || busy !== null}
                      className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300 disabled:opacity-50"
                    >
                      {busy === 'Updating' ? 'Updating…' : 'Update'}
                    </button>
                    <button
                      onClick={() => handleRemove(summary)}
                      disabled={busy !== null}
                      className="px-4 py-2 bg-red-50 text-red-700 rounded-md hover:bg-red-100 font-medium border border-red-200 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!rally || !computed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading…</p>
      </div>
    );
  }

  // --- one rally -----------------------------------------------------------

  const summary = rallies?.find((candidate) => candidate.rallyId === rally.rallyId);
  const isAdmin = can(rally.user.role, 'manage:rally');
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'cards', label: 'Cards' },
    { id: 'standings', label: 'Standings' },
    { id: 'print', label: 'Print' },
    ...(isAdmin ? [{ id: 'times' as Tab, label: 'Import Times' }] : []),
    { id: 'upload', label: 'Upload', badge: summary?.pending || 0 },
  ];

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm print:hidden">
        <div className={PAGE_CONTAINER}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-4 pb-3">
            <div className="min-w-0">
              <button
                onClick={() => openRally('')}
                className="text-sm text-gray-500 hover:text-gray-800 hover:underline"
              >
                &larr; Offline rallies
              </button>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-2xl font-bold text-gray-900 truncate">{rally.rally.name}</h1>
                <span className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Offline copy
                </span>
              </div>
              <p className="text-gray-500 text-sm">
                Downloaded {formatDate(rally.downloadedAt)} · scored on this device ·{' '}
                {summary?.pending || 0} card{summary?.pending === 1 ? '' : 's'} to upload
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {connection}
              <button
                onClick={() => run('Updating', () => downloadRally(rally.rallyId))}
                disabled={!online || busy !== null}
                title="Download the rally again; cards not uploaded yet are kept"
                className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300 disabled:opacity-50"
              >
                {busy === 'Updating' ? 'Updating…' : 'Update from Server'}
              </button>
              {online && (
                <Link
                  href={`/rallies/${rally.rallyId}`}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200 font-medium border border-gray-300"
                >
                  Online Dashboard
                </Link>
              )}
            </div>
          </div>

          <nav className="flex gap-1 -mb-px overflow-x-auto" aria-label="Offline sections">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  setTab(entry.id);
                  window.scrollTo({ top: 0 });
                }}
                aria-current={tab === entry.id ? 'page' : undefined}
                className={`flex-shrink-0 whitespace-nowrap px-4 py-2.5 text-base font-semibold border-b-2 transition-colors ${
                  tab === entry.id
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                }`}
              >
                {entry.label}
                {entry.badge ? (
                  <span className="ml-2 px-2 py-0.5 rounded-full text-sm font-bold bg-amber-100 text-amber-800">
                    {entry.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* The print tab is a full page of its own — the result sheets on A4 — so
          it is not boxed into the workspace's container. */}
      {tab === 'print' ? (
        <StandingsPrintView
          rally={{ _id: rally.rallyId, name: rally.rally.name, code: rally.rally.code }}
          standings={computed.standings.standings as any}
          stages={computed.standings.stages}
          routes={computed.standings.routes}
          error={null}
        />
      ) : (
        <div className={`${PAGE_CONTAINER} py-6`}>
          {errorBanner}

          {tab === 'cards' && (
            <div className="bg-white rounded-lg shadow-lg p-4">
              <OfflineCards rally={rally} records={records} scored={computed.sheets} />
            </div>
          )}

          {tab === 'standings' && (
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex flex-wrap justify-between items-end gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">Standings</h2>
                  <p className="text-gray-600 text-sm mt-1">
                    Ranked on this device from the downloaded copy and the cards typed here, with
                    the same rules as the server — the standings online will read the same once
                    the cards are uploaded.
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
                </div>
              </div>
              <StandingsTable
                entries={visibleStandings}
                hasStandings={computed.standings.standings.length > 0}
                totalStages={computed.standings.totalStages}
              />
            </div>
          )}

          {tab === 'times' && isAdmin && timeSource && (
            <TimeImportWizard
              key={rally.rallyId}
              initialRallyId={rally.rallyId}
              source={timeSource}
            />
          )}

          {tab === 'upload' && (
            <OfflineSyncPanel
              rally={rally}
              records={records}
              scored={computed.sheets}
              online={online}
            />
          )}
        </div>
      )}
    </div>
  );
}
