'use client';

import React from 'react';

import {
  haversineMeters,
  type GeoPoint,
  type ScanEntry,
} from '../lib/scanLocations';

// The scans of one route sign, drawn around where that sign stands.
//
// Deliberately not a map: the CSP (next.config.ts) lets no third-party tiles
// into the page, and an official does not need a map to see the shape of the
// answer — a tight cluster with three dots out at the edge *is* the answer.
// It is plain inline SVG, the same choice QrCode.tsx makes.
//
// Everything is projected to metres around the reference point, which is only
// sound over a small area — and a hundred metres is a small area. A scan too
// far out to plot is pinned to the rim with its distance next to it, so a crew
// that scanned from home does not squash the cluster into a single pixel.

interface ScanMapProps {
  reference: GeoPoint;
  scans: ScanEntry[];
  radiusMeters: number;
  size?: number;
}

// Half the width of the plot, in metres: wide enough to show the radius circle
// with room around it, and to fit the near misses, but never so wide that a
// crew 40 km away decides the scale.
function viewExtent(distances: number[], radiusMeters: number): number {
  const plottable = distances.filter((distance) => distance <= radiusMeters * 4);
  const widest = plottable.length > 0 ? Math.max(...plottable) : 0;
  return Math.max(radiusMeters * 1.4, widest * 1.15);
}

function niceScaleBar(extent: number): number {
  const target = extent / 2;
  const candidates = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return candidates.filter((value) => value <= target).pop() || candidates[0];
}

export default function ScanMap({
  reference,
  scans,
  radiusMeters,
  size = 260,
}: ScanMapProps) {
  const located = scans.filter(
    (scan) => typeof scan.latitude === 'number' && typeof scan.longitude === 'number'
  );

  const metresPerDegree = 111320;
  const cosLat = Math.cos((reference.latitude * Math.PI) / 180);

  const points = located.map((scan) => {
    const east = (scan.longitude! - reference.longitude) * metresPerDegree * cosLat;
    const north = (scan.latitude! - reference.latitude) * metresPerDegree;
    const distance =
      scan.distanceMeters ??
      haversineMeters(
        { latitude: scan.latitude!, longitude: scan.longitude! },
        reference
      );

    return { scan, east, north, distance };
  });

  const extent = viewExtent(points.map((point) => point.distance), radiusMeters);
  // The drawing is 200 units wide, whatever the extent in metres is.
  const toUnits = (meters: number) => (meters / extent) * 100;
  const scaleBar = niceScaleBar(extent);

  return (
    <svg
      viewBox="-110 -110 220 220"
      width={size}
      height={size}
      role="img"
      aria-label={`Scans around this sign, ${Math.round(extent)} metres from the centre to the edge`}
      className="bg-slate-50 rounded-lg border border-gray-300"
    >
      {/* The rim: everything outside it is drawn on it */}
      <circle cx="0" cy="0" r="100" fill="none" stroke="#cbd5e1" strokeWidth="1" />

      {/* The radius the check flags on */}
      <circle
        cx="0"
        cy="0"
        r={toUnits(radiusMeters)}
        fill="#34d39914"
        stroke="#10b981"
        strokeWidth="1"
        strokeDasharray="4 3"
      />

      {/* The sign itself */}
      <g stroke="#334155" strokeWidth="1.5">
        <line x1="-5" y1="0" x2="5" y2="0" />
        <line x1="0" y1="-5" x2="0" y2="5" />
      </g>

      {points.map(({ scan, east, north, distance }, index) => {
        const beyond = distance > extent;
        const angle = Math.atan2(north, east);
        // A scan off the plot is put on the rim in the direction it lies.
        const x = beyond ? Math.cos(angle) * 100 : toUnits(east);
        const y = beyond ? -Math.sin(angle) * 100 : -toUnits(north);
        const flagged = scan.status === 'far';

        return (
          <g key={`${scan.eq}-${index}`}>
            <circle
              cx={x}
              cy={y}
              r={flagged ? 4 : 3}
              fill={flagged ? '#dc2626' : '#059669'}
              fillOpacity={beyond ? 1 : 0.8}
              stroke="#ffffff"
              strokeWidth="0.8"
            />
            {flagged && (
              <text
                x={x + 6}
                y={y + 3}
                fontSize="8"
                fill="#991b1b"
                fontWeight="600"
              >
                {scan.eq}
                {beyond ? ' ↗' : ''}
              </text>
            )}
          </g>
        );
      })}

      {/* Scale bar, bottom left */}
      <g>
        <line
          x1="-100"
          y1="100"
          x2={-100 + toUnits(scaleBar)}
          y2="100"
          stroke="#334155"
          strokeWidth="1.5"
        />
        <text x="-100" y="95" fontSize="8" fill="#334155">
          {scaleBar} m
        </text>
      </g>
    </svg>
  );
}
