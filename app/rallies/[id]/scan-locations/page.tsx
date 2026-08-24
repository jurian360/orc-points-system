'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import ClassificationBadge from '../../../components/ClassificationBadge';
import { crewLabel, type ClassificationValue } from '../../../lib/participants';

// The anti-cheat overview of a whole rally.
//
// The stage pages hold the evidence — which crew stood where when they scanned
// which sign. This page holds the pattern: a crew flagged on one sign of one
// stage has a phone with a poor fix, a crew flagged on five signs of three
// stages was driving somewhere else while somebody sent them the pictures.

interface StageSummary {
  _id: string;
  name: string;
  radiusMeters: number;
  signs: number;
  signsWithoutReference: number;
  scans: number;
  located: number;
  flagged: number;
  missing: number;
  typed: number;
  flaggedParticipants: number;
}

interface ParticipantSummary {
  eq: number;
  classification: ClassificationValue | string;
  driverName: string;
  navigatorName: string;
  scans: number;
  located: number;
  flagged: number;
  missing: number;
  letters: number;
  typed: number;
  flaggedStages: { stageId: string; stageName: string; signs: string[] }[];
}

interface Overview {
  rally: { _id: string; name: string };
  stages: StageSummary[];
  participants: ParticipantSummary[];
  totals: {
    scans: number;
    located: number;
    flagged: number;
    missing: number;
    typed: number;
    flaggedParticipants: number;
  };
}

export default function RallyScanLocationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [rallyId, setRallyId] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(true);

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    resolve();
  }, [params]);

  const load = useCallback(async () => {
    if (!rallyId) return;

    try {
      const response = await fetch(`/api/rallies/${rallyId}/scan-locations`);
      if (!response.ok) throw new Error('Failed to load the scan locations');
      setData(await response.json());
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load the scan locations. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [rallyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading scan locations...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Rally not found'}</p>
          <Link href="/rallies" className="text-blue-600 hover:underline text-lg">
            Back to Rallies
          </Link>
        </div>
      </div>
    );
  }

  const visible = onlyFlagged
    ? data.participants.filter(
        (entry) => entry.flagged > 0 || entry.missing > 0 || entry.typed > 0
      )
    : data.participants;

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className="max-w-[1700px] mx-auto p-4">
        <div className="mb-4">
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-base">
            &larr; Back to {data.rally.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">
            Scan Locations — {data.rally.name}
          </h1>
          <p className="text-gray-700 text-base">
            Every route QR code the crews scanned, checked against where its sign stands. Open a
            stage to see the map and the coordinates behind these numbers.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mb-6 px-6 py-4 grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-600 uppercase">Scans</p>
            <p className="text-2xl font-bold text-gray-900">{data.totals.scans}</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-600 uppercase">Flagged scans</p>
            <p
              className={`text-2xl font-bold ${
                data.totals.flagged > 0 ? 'text-red-700' : 'text-gray-900'
              }`}
            >
              {data.totals.flagged}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-600 uppercase">Crews flagged</p>
            <p
              className={`text-2xl font-bold ${
                data.totals.flaggedParticipants > 0 ? 'text-red-700' : 'text-gray-900'
              }`}
            >
              {data.totals.flaggedParticipants}
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-600 uppercase">No location</p>
            <p
              className={`text-2xl font-bold ${
                data.totals.missing > 0 ? 'text-amber-700' : 'text-gray-900'
              }`}
            >
              {data.totals.missing}
            </p>
          </div>
          <div>
            <p
              className="text-sm font-semibold text-gray-600 uppercase"
              title="Letters on a card that no scan accounts for — typed in by hand"
            >
              Typed letters
            </p>
            <p
              className={`text-2xl font-bold ${
                data.totals.typed > 0 ? 'text-amber-700' : 'text-gray-900'
              }`}
            >
              {data.totals.typed}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mb-6 overflow-hidden">
          <div className="px-6 py-4 border-b-2 border-gray-200">
            <h2 className="text-lg font-bold text-gray-800">Stages</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    Stage
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    Signs
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    Scans
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    Flagged
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    Crews
                  </th>
                  <th
                    className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase"
                    title="Letters on a card that no scan accounts for"
                  >
                    Typed
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    Radius
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.stages.map((stage, index) => (
                  <tr key={stage._id} className="hover:bg-gray-50">
                    <td className="px-6 py-2 text-base text-gray-900 font-medium">
                      <span className="text-gray-400 mr-2">{index + 1}.</span>
                      {stage.name}
                      {stage.signsWithoutReference > 0 && (
                        <span className="ml-2 text-sm text-gray-600">
                          ({stage.signsWithoutReference} not located)
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-2 text-right text-base text-gray-800">{stage.signs}</td>
                    <td className="px-6 py-2 text-right text-base text-gray-800">{stage.scans}</td>
                    <td
                      className={`px-6 py-2 text-right text-base font-semibold ${
                        stage.flagged > 0 ? 'text-red-700' : 'text-gray-800'
                      }`}
                    >
                      {stage.flagged}
                    </td>
                    <td
                      className={`px-6 py-2 text-right text-base ${
                        stage.flaggedParticipants > 0 ? 'text-red-700 font-semibold' : 'text-gray-800'
                      }`}
                    >
                      {stage.flaggedParticipants}
                    </td>
                    <td
                      className={`px-6 py-2 text-right text-base ${
                        stage.typed > 0 ? 'text-amber-700 font-semibold' : 'text-gray-800'
                      }`}
                    >
                      {stage.typed}
                    </td>
                    <td className="px-6 py-2 text-right text-base text-gray-600">
                      {stage.radiusMeters} m
                    </td>
                    <td className="px-6 py-2 text-right">
                      <Link
                        href={`/rallies/${rallyId}/stages/${stage._id}/scan-locations`}
                        className="text-blue-600 hover:text-blue-900 font-medium text-base"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}

                {data.stages.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-3 text-base text-gray-600">
                      This rally has no stages yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b-2 border-gray-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-800">Crews</h2>
              <p className="text-base text-gray-700">
                Worst first. &quot;Flagged&quot; counts scans made further than the stage&apos;s
                radius from the sign.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-base">
              {(
                [
                  [true, 'Needs looking at'],
                  [false, `All crews (${data.participants.length})`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  onClick={() => setOnlyFlagged(value)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    onlyFlagged === value
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    EQ
                  </th>
                  <th className="px-6 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    Crew
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    Scans
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    Flagged
                  </th>
                  <th
                    className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase"
                    title="Letters on the cards that no scan accounts for"
                  >
                    Typed
                  </th>
                  <th className="px-6 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    Where it went wrong
                  </th>
                  <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    No location
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {visible.map((entry) => (
                  <tr key={entry.eq} className={entry.flagged > 0 ? 'bg-red-50' : 'hover:bg-gray-50'}>
                    <td className="px-6 py-2 whitespace-nowrap">
                      <Link
                        href={`/rallies/${rallyId}/participants/${entry.eq}`}
                        className="text-blue-600 hover:underline font-semibold text-base"
                      >
                        {entry.eq}
                      </Link>
                    </td>
                    <td className="px-6 py-2 text-base text-gray-800">
                      <span className="inline-flex items-center gap-2">
                        <ClassificationBadge classification={entry.classification} />
                        {crewLabel(entry)}
                      </span>
                    </td>
                    <td className="px-6 py-2 text-right text-base text-gray-800">{entry.scans}</td>
                    <td
                      className={`px-6 py-2 text-right text-base font-semibold ${
                        entry.flagged > 0 ? 'text-red-700' : 'text-gray-800'
                      }`}
                    >
                      {entry.flagged}
                    </td>
                    <td
                      className={`px-6 py-2 text-right text-base ${
                        entry.typed > 0 ? 'text-amber-700 font-semibold' : 'text-gray-800'
                      }`}
                      title={`${entry.letters} letters on the cards, ${entry.scans} scanned`}
                    >
                      {entry.typed}
                    </td>
                    <td className="px-6 py-2 text-base text-gray-800">
                      {entry.flaggedStages.length === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {entry.flaggedStages.map((stage) => (
                            <Link
                              key={stage.stageId}
                              href={`/rallies/${rallyId}/stages/${stage.stageId}/scan-locations`}
                              className="text-blue-700 hover:underline"
                            >
                              {stage.stageName}:{' '}
                              <span className="font-mono text-red-700">
                                {stage.signs.join('  ')}
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-6 py-2 text-right text-base ${
                        entry.missing > 0 ? 'text-amber-700 font-semibold' : 'text-gray-800'
                      }`}
                    >
                      {entry.missing}
                    </td>
                  </tr>
                ))}

                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-3 text-base text-gray-600">
                      {data.participants.length === 0
                        ? 'No crew has handed in a card with scan locations yet.'
                        : 'Every scan of this rally was made at its sign.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
