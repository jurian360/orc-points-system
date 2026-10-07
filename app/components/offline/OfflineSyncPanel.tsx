'use client';

// The Upload tab of the offline workspace (app/offline): the cards changed on
// this device and not uploaded yet, the button that uploads them, and the cards
// the upload could not write because somebody else changed them meanwhile —
// shown side by side, so an official chooses which one is the card.

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import ControlekaartCard from '../ControlekaartCard';
import { crewLabel } from '../../lib/participants';
import {
  OfflineSyncError,
  resolveConflict,
  syncRally,
  type OfflineRally,
  type OfflineSheet,
  type ScoredOfflineSheet,
} from '../../lib/offline/store';

interface OfflineSyncPanelProps {
  rally: OfflineRally;
  records: OfflineSheet[];
  scored: ScoredOfflineSheet[];
  online: boolean;
}

export default function OfflineSyncPanel({ rally, records, scored, online }: OfflineSyncPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' } | null>(
    null
  );
  const [needsLogin, setNeedsLogin] = useState(false);

  const stageById = useMemo(
    () => new Map(rally.stages.map((stage) => [String(stage._id), stage])),
    [rally.stages]
  );
  const crewByEq = useMemo(
    () => new Map(rally.participants.map((participant: any) => [participant.eq, participant])),
    [rally.participants]
  );
  const scoredByKey = useMemo(() => new Map(scored.map((sheet) => [sheet.key, sheet])), [scored]);

  const pending = records.filter((record) => record.dirty && !record.conflict);
  const conflicts = records.filter((record) => record.conflict);

  const describe = (record: OfflineSheet) => {
    const stage = stageById.get(record.stageId);
    const crew = crewLabel(crewByEq.get(record.eq));
    return `${stage?.name || 'Unknown stage'} · EQ ${record.eq}${crew ? ` (${crew})` : ''}`;
  };

  const change = (record: OfflineSheet) =>
    record.deleted ? 'Deleted' : record.serverId ? 'Changed' : 'New';

  const handleUpload = async () => {
    setUploading(true);
    setMessage(null);
    setNeedsLogin(false);
    try {
      const summary = await syncRally(rally.rallyId);
      const parts = [`${summary.saved} card${summary.saved === 1 ? '' : 's'} uploaded`];
      if (summary.conflicts > 0) parts.push(`${summary.conflicts} in conflict — choose below`);
      if (summary.errors > 0) parts.push(`${summary.errors} refused`);
      setMessage({
        text: `${parts.join(', ')}. The copy on this device has been brought up to date.`,
        tone: summary.conflicts + summary.errors > 0 ? 'warn' : 'ok',
      });
    } catch (err) {
      if (err instanceof OfflineSyncError && err.reason === 'login') setNeedsLogin(true);
      setMessage({
        text: err instanceof Error ? err.message : 'The upload failed.',
        tone: 'error',
      });
    } finally {
      setUploading(false);
    }
  };

  const toneClass = {
    ok: 'bg-green-100 border-green-500 text-green-800',
    warn: 'bg-amber-100 border-amber-500 text-amber-900',
    error: 'bg-red-100 border-red-500 text-red-700',
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-base text-gray-700">
          {pending.length === 0 && conflicts.length === 0
            ? 'Everything typed on this device has been uploaded.'
            : `${pending.length} card${pending.length === 1 ? '' : 's'} waiting to be uploaded${
                conflicts.length > 0 ? `, ${conflicts.length} in conflict` : ''
              }. Uploading happens on its own as soon as there is a connection.`}
        </p>
        <button
          onClick={handleUpload}
          disabled={!online || uploading || pending.length === 0}
          title={online ? undefined : 'No connection'}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium shadow-sm disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Upload Now'}
        </button>
      </div>

      {message && (
        <div className={`border-l-4 px-4 py-3 rounded mb-4 font-medium ${toneClass[message.tone]}`}>
          {message.text}
          {needsLogin && (
            <>
              {' '}
              <Link href="/login" className="underline">
                Log in
              </Link>{' '}
              and come back to Offline — nothing typed here is lost.
            </>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Card</th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Change</th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Last upload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {pending.map((record) => (
                <tr key={record.key}>
                  <td className="px-4 py-2 text-base text-gray-900">{describe(record)}</td>
                  <td className="px-4 py-2 text-base text-gray-700">{change(record)}</td>
                  <td className="px-4 py-2 text-sm">
                    {record.error ? (
                      <span className="text-red-700 font-medium">Refused: {record.error}</span>
                    ) : (
                      <span className="text-gray-500">Not yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {conflicts.map((record) => {
        const stage = stageById.get(record.stageId);
        const server = record.conflict?.server;
        const mine = scoredByKey.get(record.key);
        return (
          <div key={record.key} className="bg-white rounded-lg shadow border-2 border-red-200 mb-6">
            <div className="px-4 py-3 border-b border-red-200 bg-red-50">
              <h3 className="text-lg font-bold text-red-800">Conflict — {describe(record)}</h3>
              <p className="text-sm text-red-800">
                This card was changed on the server while this device was offline. Choose which
                version is the card; the other one is discarded.
              </p>
            </div>
            <div className="grid lg:grid-cols-2 gap-4 p-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-800">Typed on this device</h4>
                  <button
                    onClick={() => resolveConflict(record.key, 'mine')}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                  >
                    Keep Mine
                  </button>
                </div>
                {record.deleted || !mine ? (
                  <p className="text-gray-700">Deleted on this device.</p>
                ) : (
                  <ControlekaartCard
                    scoreKey={stage?.scoreKey || []}
                    answers={mine.answers}
                    timePenalties={mine.timePenalties}
                    merkScoreKey={stage?.merkScoreKey}
                    merkScores={mine.merkScores}
                    diversenCount={mine.diversenCount}
                    disqualified={mine.disqualified}
                  />
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-800">On the server</h4>
                  <button
                    onClick={() => resolveConflict(record.key, 'server')}
                    className="px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-300 rounded-md hover:bg-gray-200 text-sm font-medium"
                  >
                    Use Server&apos;s
                  </button>
                </div>
                {server ? (
                  <ControlekaartCard
                    scoreKey={stage?.scoreKey || []}
                    answers={server.answers || []}
                    timePenalties={server.timePenalties}
                    merkScoreKey={stage?.merkScoreKey}
                    merkScores={server.merkScores}
                    diversenCount={server.diversenCount}
                    disqualified={server.disqualified}
                  />
                ) : (
                  <p className="text-gray-700">Deleted on the server.</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
