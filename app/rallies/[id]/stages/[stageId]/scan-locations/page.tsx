'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import ClassificationBadge from '../../../../../components/ClassificationBadge';
import ScanMap from '../../../../../components/ScanMap';
import { crewLabel, type ClassificationValue } from '../../../../../lib/participants';
import {
  formatCoordinate,
  formatDistance,
  haversineMeters,
  mapLink,
  MIN_SCANS_FOR_CONSENSUS,
  type ScanEntry,
  type ScanReport,
  type SignReport,
} from '../../../../../lib/scanLocations';

// The anti-cheat page of one stage: where every crew was when they scanned the
// route QR codes of this stage into their card.
//
// One section per sign — a sign being one letter that goes into one row — with
// where that sign stands, the scans around it and the crews that scanned it
// from somewhere else. A crew that was handed a photograph of the sign scans it
// from wherever they happen to be, and that is what shows up here.

interface Crew {
  eq: number;
  classification: ClassificationValue | string;
  driverName: string;
  navigatorName: string;
}

interface ScanLocationsResponse {
  rally: { _id: string; name: string };
  stage: { _id: string; name: string };
  radiusMeters: number;
  report: ScanReport;
  crews: Crew[];
}

const STATUS_LABEL: Record<ScanEntry['status'], string> = {
  ok: 'At the sign',
  far: 'Away from the sign',
  unknown: 'Sign not located',
  missing: 'No location',
};

const STATUS_CLASS: Record<ScanEntry['status'], string> = {
  ok: 'bg-emerald-100 text-emerald-800',
  far: 'bg-red-100 text-red-800',
  unknown: 'bg-gray-100 text-gray-700',
  missing: 'bg-amber-100 text-amber-800',
};

function formatMoment(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function StageScanLocationsPage({
  params,
}: {
  params: Promise<{ id: string; stageId: string }>;
}) {
  const [rallyId, setRallyId] = useState('');
  const [stageId, setStageId] = useState('');
  const [data, setData] = useState<ScanLocationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [radiusInput, setRadiusInput] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  // Which signs show every scan rather than only the ones worth reading.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Which sign has its "type the coordinates" form open, and what is in it.
  const [pinning, setPinning] = useState<string | null>(null);
  const [pinLat, setPinLat] = useState('');
  const [pinLng, setPinLng] = useState('');

  useEffect(() => {
    const resolve = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
      setStageId(resolved.stageId);
    };
    resolve();
  }, [params]);

  const load = useCallback(async () => {
    if (!stageId) return;

    try {
      const response = await fetch(`/api/stages/${stageId}/scan-locations`);
      if (!response.ok) throw new Error('Failed to load the scan locations');
      const payload: ScanLocationsResponse = await response.json();
      setData(payload);
      setRadiusInput(String(payload.radiusMeters));
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load the scan locations. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [stageId]);

  useEffect(() => {
    load();
  }, [load]);

  // Every write answers with the whole report, so the page never has to guess
  // what changed — the same shape the QR page uses.
  const post = async (body: Record<string, unknown>, failure: string) => {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/stages/${stageId}/scan-locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || failure);

      setData(payload);
      setRadiusInput(String(payload.radiusMeters));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  };

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
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Stage not found'}</p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  const { report } = data;
  const crewByEq = new Map(data.crews.map((crew) => [crew.eq, crew]));
  const visibleSigns = onlyFlagged
    ? report.signs.filter((sign) => sign.flagged > 0)
    : report.signs;

  const crewOf = (eq: number) => {
    const crew = crewByEq.get(eq);
    return crew ? crewLabel(crew) : '';
  };

  const renderSign = (sign: SignReport) => {
    const shown = expanded[sign.key]
      ? sign.scans
      : sign.scans.filter((scan) => scan.status !== 'ok');
    const hidden = sign.scans.length - shown.length;
    // A pin that disagrees with the crowd is worth saying out loud: one of the
    // two is wrong, and an official is the only one who can tell which.
    const pinDrift =
      sign.referenceSource === 'pinned' && sign.consensus && sign.reference
        ? haversineMeters(sign.reference, sign.consensus)
        : null;

    return (
      <div
        key={sign.key}
        className="bg-white rounded-xl shadow-xl border-2 border-gray-200 overflow-hidden"
      >
        <div className="px-6 py-4 border-b-2 border-gray-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              Row {sign.rowNumber} &middot; letter{' '}
              <span className="font-mono text-xl">{sign.letter}</span>
            </h3>
            <p className="text-base text-gray-700">
              {sign.scans.length} scan{sign.scans.length === 1 ? '' : 's'}
              {sign.flagged > 0 && (
                <span className="text-red-700 font-semibold">
                  {' '}
                  &middot; {sign.flagged} away from the sign
                </span>
              )}
              {sign.missing > 0 && (
                <span className="text-amber-700 font-medium">
                  {' '}
                  &middot; {sign.missing} without a location
                </span>
              )}
            </p>
          </div>

          <span
            className={`self-start px-3 py-1 rounded-lg text-sm font-semibold ${
              sign.referenceSource === 'pinned'
                ? 'bg-indigo-100 text-indigo-800'
                : sign.referenceSource === 'consensus'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-700'
            }`}
          >
            {sign.referenceSource === 'pinned'
              ? 'Location pinned by an official'
              : sign.referenceSource === 'consensus'
                ? `Location from the crews (${sign.located} scans)`
                : 'Location unknown'}
          </span>
        </div>

        <div className="px-6 py-4 flex flex-col xl:flex-row gap-6">
          <div className="shrink-0">
            {sign.reference ? (
              <ScanMap
                reference={sign.reference}
                scans={sign.scans}
                radiusMeters={report.radiusMeters}
              />
            ) : (
              <div className="w-[260px] h-[260px] rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center p-4 text-center text-base text-gray-600">
                Not enough scans to say where this sign stands. It needs{' '}
                {MIN_SCANS_FOR_CONSENSUS} located scans, or an official who pins it.
              </div>
            )}

            <div className="mt-3 text-base text-gray-700 space-y-1">
              {sign.reference && (
                <p>
                  <span className="font-semibold">Sign:</span>{' '}
                  <a
                    href={mapLink(sign.reference)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline font-mono"
                  >
                    {formatCoordinate(sign.reference)}
                  </a>
                </p>
              )}
              {sign.reference && sign.flagged + sign.located > 0 && (
                <p className="text-gray-600">
                  Crews at the sign spread over {formatDistance(sign.spreadMeters)} &middot;
                  flagged beyond {report.radiusMeters} m
                </p>
              )}
              {pinDrift !== null && pinDrift > report.radiusMeters && (
                <p className="text-amber-700 font-medium">
                  The pin is {formatDistance(pinDrift)} from where the crews cluster — check
                  the coordinates.
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {sign.consensus && sign.referenceSource !== 'pinned' && (
                <button
                  onClick={() =>
                    post(
                      {
                        action: 'pin',
                        rowNumber: sign.rowNumber,
                        letter: sign.letter,
                        latitude: sign.consensus!.latitude,
                        longitude: sign.consensus!.longitude,
                      },
                      'Failed to pin this sign'
                    )
                  }
                  disabled={busy}
                  className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-sm transition-colors disabled:opacity-50"
                  title="Freeze this spot as the official location of the sign"
                >
                  Pin this spot
                </button>
              )}
              {sign.referenceSource === 'pinned' && (
                <button
                  onClick={() =>
                    post(
                      { action: 'unpin', rowNumber: sign.rowNumber, letter: sign.letter },
                      'Failed to remove this pin'
                    )
                  }
                  disabled={busy}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm transition-colors disabled:opacity-50"
                  title="Go back to the location the crews' own scans give"
                >
                  Remove pin
                </button>
              )}
              <button
                onClick={() => {
                  setPinning(pinning === sign.key ? null : sign.key);
                  setPinLat(sign.reference ? String(sign.reference.latitude) : '');
                  setPinLng(sign.reference ? String(sign.reference.longitude) : '');
                }}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium text-sm transition-colors"
              >
                {pinning === sign.key ? 'Cancel' : 'Type coordinates'}
              </button>
            </div>

            {pinning === sign.key && (
              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-sm text-gray-700 mb-2">
                  Where this sign stands, in degrees.
                </p>
                <div className="flex gap-2">
                  <input
                    value={pinLat}
                    onChange={(event) => setPinLat(event.target.value)}
                    placeholder="52.09123"
                    className="w-full px-2 py-1.5 border-2 border-gray-300 rounded-lg text-base"
                    aria-label="Latitude"
                  />
                  <input
                    value={pinLng}
                    onChange={(event) => setPinLng(event.target.value)}
                    placeholder="5.12345"
                    className="w-full px-2 py-1.5 border-2 border-gray-300 rounded-lg text-base"
                    aria-label="Longitude"
                  />
                </div>
                <button
                  onClick={async () => {
                    const latitude = Number(pinLat);
                    const longitude = Number(pinLng);
                    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                      setError('Latitude and longitude have to be numbers, e.g. 52.09123');
                      return;
                    }
                    await post(
                      {
                        action: 'pin',
                        rowNumber: sign.rowNumber,
                        letter: sign.letter,
                        latitude,
                        longitude,
                      },
                      'Failed to pin this sign'
                    );
                    setPinning(null);
                  }}
                  disabled={busy}
                  className="mt-2 px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium text-sm transition-colors disabled:opacity-50"
                >
                  Save location
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    EQ
                  </th>
                  <th className="px-3 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    Crew
                  </th>
                  <th className="px-3 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                    From the sign
                  </th>
                  <th className="px-3 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    Scanned
                  </th>
                  <th className="px-3 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                    Where
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {shown.map((scan, index) => (
                  <tr
                    key={`${scan.eq}-${scan.column}-${index}`}
                    className={scan.status === 'far' ? 'bg-red-50' : ''}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/rallies/${rallyId}/participants/${scan.eq}`}
                        className="text-blue-600 hover:underline font-semibold text-base"
                      >
                        {scan.eq}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-base text-gray-800">
                      <span className="inline-flex items-center gap-2">
                        <ClassificationBadge
                          classification={crewByEq.get(scan.eq)?.classification || ''}
                        />
                        <span className="truncate max-w-[16rem]">{crewOf(scan.eq)}</span>
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right text-base font-semibold whitespace-nowrap ${
                        scan.status === 'far' ? 'text-red-700' : 'text-gray-800'
                      }`}
                    >
                      {formatDistance(scan.distanceMeters)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 rounded text-sm font-semibold ${STATUS_CLASS[scan.status]}`}
                      >
                        {STATUS_LABEL[scan.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-base text-gray-700 whitespace-nowrap">
                      {formatMoment(scan.scannedAt)}
                    </td>
                    <td className="px-3 py-2 text-base whitespace-nowrap">
                      {typeof scan.latitude === 'number' && typeof scan.longitude === 'number' ? (
                        <a
                          href={mapLink({
                            latitude: scan.latitude,
                            longitude: scan.longitude,
                          })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-mono text-sm"
                        >
                          {formatCoordinate({
                            latitude: scan.latitude,
                            longitude: scan.longitude,
                          })}
                          {scan.accuracy > 0 && (
                            <span className="text-gray-500"> &plusmn;{scan.accuracy} m</span>
                          )}
                        </a>
                      ) : (
                        <span className="text-gray-500">The phone gave none</span>
                      )}
                    </td>
                  </tr>
                ))}

                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-base text-gray-600">
                      Every crew scanned this sign at the sign.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {(hidden > 0 || expanded[sign.key]) && (
              <button
                onClick={() =>
                  setExpanded((current) => ({ ...current, [sign.key]: !current[sign.key] }))
                }
                className="mt-3 text-blue-600 hover:underline font-medium text-base"
              >
                {expanded[sign.key]
                  ? 'Show only what needs looking at'
                  : `Show all ${sign.scans.length} scans`}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 py-4">
      <div className="max-w-[1700px] mx-auto p-4">
        <div className="mb-4">
          <Link
            href={`/rallies/${rallyId}/stages/${stageId}`}
            className="text-blue-600 hover:underline text-base"
          >
            &larr; Back to {data.stage.name}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">
            Scan Locations — {data.stage.name}
          </h1>
          <p className="text-gray-700 text-base">
            Where each crew of <span className="font-semibold">{data.rally.name}</span> was when
            they scanned a route QR code into their card. A crew that was sent a photograph of a
            sign scans it from wherever they are — so a scan more than{' '}
            {report.radiusMeters} m from the sign is one to look into.{' '}
            <Link
              href={`/rallies/${rallyId}/scan-locations`}
              className="text-blue-600 hover:underline"
            >
              The whole rally at a glance
            </Link>
            .
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mb-6">
          <div className="px-6 py-4 grid grid-cols-2 lg:grid-cols-6 gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase">Scans</p>
              <p className="text-2xl font-bold text-gray-900">{report.totals.scans}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase">Signs</p>
              <p className="text-2xl font-bold text-gray-900">{report.totals.signs}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase">Flagged scans</p>
              <p
                className={`text-2xl font-bold ${
                  report.totals.flagged > 0 ? 'text-red-700' : 'text-gray-900'
                }`}
              >
                {report.totals.flagged}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase">Crews flagged</p>
              <p
                className={`text-2xl font-bold ${
                  report.totals.flaggedParticipants > 0 ? 'text-red-700' : 'text-gray-900'
                }`}
              >
                {report.totals.flaggedParticipants}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase">No location</p>
              <p
                className={`text-2xl font-bold ${
                  report.totals.missing > 0 ? 'text-amber-700' : 'text-gray-900'
                }`}
              >
                {report.totals.missing}
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
                  report.totals.typed > 0 ? 'text-amber-700' : 'text-gray-900'
                }`}
              >
                {report.totals.typed}
              </p>
            </div>
          </div>

          <div className="px-6 py-4 border-t-2 border-gray-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="radius" className="text-base text-gray-700 font-medium">
                Flag a scan beyond
              </label>
              <input
                id="radius"
                value={radiusInput}
                onChange={(event) => setRadiusInput(event.target.value)}
                inputMode="numeric"
                className="w-24 px-2 py-1.5 border-2 border-gray-300 rounded-lg text-base text-right"
              />
              <span className="text-base text-gray-700">m from its sign</span>
              <button
                onClick={() =>
                  post(
                    { action: 'radius', radiusMeters: Number(radiusInput) },
                    'Failed to save the radius'
                  )
                }
                disabled={busy || radiusInput === String(report.radiusMeters)}
                className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium text-base transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-base">
              <span className="text-gray-700 font-medium mr-1">Show:</span>
              {(
                [
                  [false, `All signs (${report.signs.length})`],
                  [
                    true,
                    `Only flagged (${report.signs.filter((sign) => sign.flagged > 0).length})`,
                  ],
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

          {report.totals.signsWithoutReference > 0 && (
            <div className="px-6 pb-4 text-base text-gray-700">
              {report.totals.signsWithoutReference} sign
              {report.totals.signsWithoutReference === 1 ? ' has' : 's have'} too few located
              scans to place — their scans are shown but not checked. Pin them yourself to check
              them anyway.
            </div>
          )}

          {error && (
            <div className="px-6 pb-4">
              <p className="text-red-600 font-medium text-base">{error}</p>
            </div>
          )}
        </div>

        {report.signs.length === 0 ? (
          <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 px-6 py-8 text-center">
            <p className="text-lg font-semibold text-gray-800 mb-2">
              No scan locations for this stage yet
            </p>
            <p className="text-base text-gray-700">
              They arrive with the cards the crews hand in from the app. A card typed by an
              official carries none, and neither does one handed in by a phone that refused the
              app its location.
            </p>
          </div>
        ) : (
          <div className="space-y-6">{visibleSigns.map(renderSign)}</div>
        )}

        {report.participants.length > 0 && (
          <div className="bg-white rounded-xl shadow-xl border-2 border-gray-200 mt-6 overflow-hidden">
            <div className="px-6 py-4 border-b-2 border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">Crews on this stage</h2>
              <p className="text-base text-gray-700">
                One line per crew with a card for this stage, worst first.
                &quot;Typed&quot; counts the letters no scan accounts for: the app lets a crew
                type a letter when a camera will not focus, and it is also the way around a
                location check.
              </p>
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
                      title="Letters on the card that no scan accounts for"
                    >
                      Typed
                    </th>
                    <th className="px-6 py-2 text-left text-sm font-bold text-gray-700 uppercase">
                      Signs
                    </th>
                    <th className="px-6 py-2 text-right text-sm font-bold text-gray-700 uppercase">
                      No location
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {report.participants.map((entry) => (
                    <tr
                      key={entry.eq}
                      className={entry.flagged > 0 ? 'bg-red-50' : 'hover:bg-gray-50'}
                    >
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
                          <ClassificationBadge
                            classification={crewByEq.get(entry.eq)?.classification || ''}
                          />
                          {crewOf(entry.eq)}
                        </span>
                      </td>
                      <td className="px-6 py-2 text-right text-base text-gray-800">
                        {entry.scans}
                      </td>
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
                        title={`${entry.letters} letters on the card, ${entry.scans} scanned`}
                      >
                        {entry.typed}
                      </td>
                      <td className="px-6 py-2 text-base font-mono text-red-700">
                        {entry.flaggedSigns.join('  ') || (
                          <span className="text-gray-400 font-sans">—</span>
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
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
