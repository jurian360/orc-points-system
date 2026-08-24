// Where a crew was when they scanned a route QR code — the anti-cheat check.
//
// Along the route of a stage stand signs carrying a QR code like `15:B`: scan
// it and the letter B drops into row 15 of the control card. The letters are
// the whole point of the rally, so a crew that photographs a sign and sends the
// picture to a friend two villages away has handed them the answer without them
// ever driving past it.
//
// The phone therefore records where it was when it scanned (see the Android
// app's ScanLocation) and sends those coordinates with the finalised card. This
// module is what turns that into an answer to the officials' question: *who
// scanned this sign from somewhere the sign is not?*
//
// The reference point of a sign — where it really stands — comes from one of
// two places:
//
//   pinned     an official set it, either by typing coordinates or by accepting
//              the consensus below. It wins, always.
//   consensus  derived from the scans themselves. Most crews do drive the
//              route, so their fixes cluster on the sign; the cluster centre is
//              the sign. This is what makes the check work on a stage nobody
//              surveyed with a GPS beforehand.
//
// A scan farther than the radius (100 m by default) from that point is flagged.
// A flag is evidence for an official to act on, never a penalty: nothing in
// here feeds the scoring, and a phone with no fix is reported as unlocated
// rather than as innocent or guilty.
//
// Shared by the API and the pages on purpose, exactly like app/lib/scoring.ts:
// the number an official reads has to be the number the report was built from.

// How far from its sign a scan may be before it is flagged.
export const DEFAULT_SCAN_RADIUS_METERS = 100;

// How many scans a consensus needs before it is trusted. Two crews agreeing
// prove nothing — they could be the two who shared the photo — and a sign only
// one crew ever scanned has no cluster at all.
export const MIN_SCANS_FOR_CONSENSUS = 3;

// Mean earth radius (IUGG), in metres.
const EARTH_RADIUS_METERS = 6371008.8;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

// One scan as the phone recorded it and the sheet stores it. `latitude` and
// `longitude` are null when the phone had no fix — a scan without a location is
// still a scan, and an official wants to see it.
export interface ScanLocation {
  rowNumber: number;
  column: number;
  letter: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number;
  scannedAt: string | null;
}

// The same scan, with the crew it belongs to.
export interface ScanRecord extends ScanLocation {
  eq: number;
}

// Where an official says a sign stands.
export interface ScanReference extends GeoPoint {
  rowNumber: number;
  letter: string;
}

export type ScanStatus =
  // Within the radius of the sign — the crew was there.
  | 'ok'
  // Outside it. This is the one that says somebody was handed the answer.
  | 'far'
  // No reference for this sign: not pinned, and too few scans to be sure where
  // it stands. Nothing can be said about this scan yet.
  | 'unknown'
  // The phone recorded no location at all.
  | 'missing';

export interface ScanEntry extends ScanRecord {
  distanceMeters: number | null;
  status: ScanStatus;
}

export interface SignReport {
  // `${rowNumber}:${letter}` — one sign of the route.
  key: string;
  rowNumber: number;
  letter: string;
  reference: GeoPoint | null;
  referenceSource: 'pinned' | 'consensus' | 'none';
  // The consensus of the scans, whether or not it is what the check used. Shown
  // next to a pinned reference so an official can see the two agree, and it is
  // what the "pin this" button stores.
  consensus: GeoPoint | null;
  scans: ScanEntry[];
  // Scans that carried coordinates, of which how many were flagged, plus the
  // ones the phone could not locate.
  located: number;
  flagged: number;
  missing: number;
  // How far the farthest crew still inside the radius was: a tight number means
  // the reference is solid, a number near the radius means it is not.
  spreadMeters: number;
}

export interface ParticipantScanSummary {
  eq: number;
  scans: number;
  located: number;
  flagged: number;
  missing: number;
  // The signs this crew was flagged on, e.g. ["15:B", "22:N"].
  flaggedSigns: string[];
  // Letters on the crew's card, and how many of them no scan accounts for.
  // Typing a letter instead of scanning it is the obvious way around a location
  // check — the app allows it, because a camera that will not focus must not
  // cost a crew their card — so the count is here rather than hidden.
  letters: number;
  typed: number;
}

// One crew's card, as much of it as this check needs: how many ORC letters it
// carries. Passed in so a crew who scanned nothing at all still gets a line.
export interface CardSummary {
  eq: number;
  letters: number;
}

export interface ScanReport {
  radiusMeters: number;
  signs: SignReport[];
  participants: ParticipantScanSummary[];
  totals: {
    scans: number;
    located: number;
    flagged: number;
    missing: number;
    signs: number;
    // Signs whose place is still unknown, so their scans could not be checked.
    signsWithoutReference: number;
    // Crews with at least one flagged scan.
    flaggedParticipants: number;
    // Letters that reached a card without a scan behind them, over all crews.
    typed: number;
  };
}

// One sign of the route: a letter that goes into one row.
export function signKey(rowNumber: number, letter: string): string {
  return `${rowNumber}:${(letter || '').toUpperCase()}`;
}

export function hasPoint(scan: {
  latitude: number | null;
  longitude: number | null;
}): boolean {
  return (
    typeof scan.latitude === 'number' &&
    Number.isFinite(scan.latitude) &&
    typeof scan.longitude === 'number' &&
    Number.isFinite(scan.longitude)
  );
}

// Great-circle distance in metres. A rally runs over tens of kilometres, so the
// sphere is plenty: the error against an ellipsoid is centimetres where we care
// about a hundred metres.
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = Math.PI / 180;
  const lat1 = a.latitude * toRad;
  const lat2 = b.latitude * toRad;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * toRad;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

// Where the crowd says the sign stands.
//
// The median of the coordinates is the seed, because a median is not dragged
// away by the crew that scanned from home; the centre is then re-fitted a few
// times over the scans within one radius of it, which drops the outliers
// entirely instead of averaging them in. Returns null when too few scans
// survive that — a handful of fixes scattered over a province is not a sign.
//
// Averaging degrees is only sound over a small area; a cluster is a hundred
// metres across, so it is.
export function consensusPoint(
  points: GeoPoint[],
  radiusMeters: number = DEFAULT_SCAN_RADIUS_METERS
): GeoPoint | null {
  if (points.length < MIN_SCANS_FOR_CONSENSUS) return null;

  let centre: GeoPoint = {
    latitude: median(points.map((point) => point.latitude)),
    longitude: median(points.map((point) => point.longitude)),
  };

  let inliers = points;

  for (let round = 0; round < 4; round++) {
    const near = points.filter(
      (point) => haversineMeters(point, centre) <= radiusMeters
    );
    if (near.length === 0) break;

    inliers = near;
    centre = {
      latitude: mean(near.map((point) => point.latitude)),
      longitude: mean(near.map((point) => point.longitude)),
    };
  }

  return inliers.length >= MIN_SCANS_FOR_CONSENSUS ? centre : null;
}

// Worst first: an official opens this page to find the crews that were not
// where they should have been.
const STATUS_ORDER: Record<ScanStatus, number> = {
  far: 0,
  missing: 1,
  unknown: 2,
  ok: 3,
};

function compareScans(a: ScanEntry, b: ScanEntry): number {
  if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (a.status === 'far') return (b.distanceMeters ?? 0) - (a.distanceMeters ?? 0);
  return a.eq - b.eq;
}

// The whole report for one stage: a section per sign, and a line per crew.
export function buildScanReport(
  scans: ScanRecord[],
  references: ScanReference[] = [],
  radiusMeters: number = DEFAULT_SCAN_RADIUS_METERS,
  cards: CardSummary[] = []
): ScanReport {
  const radius = radiusMeters > 0 ? radiusMeters : DEFAULT_SCAN_RADIUS_METERS;

  const pinned = new Map<string, GeoPoint>();
  for (const reference of references) {
    if (!hasPoint(reference)) continue;
    pinned.set(signKey(reference.rowNumber, reference.letter), {
      latitude: reference.latitude,
      longitude: reference.longitude,
    });
  }

  const grouped = new Map<string, ScanRecord[]>();
  for (const scan of scans) {
    const key = signKey(scan.rowNumber, scan.letter);
    const group = grouped.get(key);
    if (group) group.push(scan);
    else grouped.set(key, [scan]);
  }

  // A sign an official pinned but nobody has scanned yet is still a sign of the
  // route, and showing it is how they check the pin they just made.
  for (const key of pinned.keys()) {
    if (!grouped.has(key)) grouped.set(key, []);
  }

  const signs: SignReport[] = [];

  for (const [key, group] of grouped) {
    const [rowPart, letter] = key.split(':');
    const rowNumber = Number(rowPart);

    const located = group.filter(hasPoint);
    const consensus = consensusPoint(
      located.map((scan) => ({
        latitude: scan.latitude as number,
        longitude: scan.longitude as number,
      })),
      radius
    );

    const pin = pinned.get(key) || null;
    const reference = pin || consensus;
    const referenceSource = pin ? 'pinned' : consensus ? 'consensus' : 'none';

    let flagged = 0;
    let spreadMeters = 0;

    const entries: ScanEntry[] = group.map((scan) => {
      if (!hasPoint(scan)) {
        return { ...scan, distanceMeters: null, status: 'missing' as ScanStatus };
      }

      if (!reference) {
        return { ...scan, distanceMeters: null, status: 'unknown' as ScanStatus };
      }

      const distanceMeters = haversineMeters(
        { latitude: scan.latitude as number, longitude: scan.longitude as number },
        reference
      );

      const status: ScanStatus = distanceMeters > radius ? 'far' : 'ok';
      if (status === 'far') flagged++;
      else spreadMeters = Math.max(spreadMeters, distanceMeters);

      return { ...scan, distanceMeters, status };
    });

    entries.sort(compareScans);

    signs.push({
      key,
      rowNumber,
      letter,
      reference,
      referenceSource,
      consensus,
      scans: entries,
      located: located.length,
      flagged,
      missing: group.length - located.length,
      spreadMeters,
    });
  }

  signs.sort((a, b) =>
    a.rowNumber === b.rowNumber
      ? a.letter.localeCompare(b.letter)
      : a.rowNumber - b.rowNumber
  );

  const byParticipant = new Map<number, ParticipantScanSummary>();

  // Seeded from the cards, so a crew whose card holds 30 letters and no scan at
  // all is a line on the report rather than an absence from it.
  for (const card of cards) {
    byParticipant.set(card.eq, {
      eq: card.eq,
      scans: 0,
      located: 0,
      flagged: 0,
      missing: 0,
      flaggedSigns: [],
      letters: card.letters,
      typed: card.letters,
    });
  }

  for (const sign of signs) {
    for (const scan of sign.scans) {
      const summary = byParticipant.get(scan.eq) || {
        eq: scan.eq,
        scans: 0,
        located: 0,
        flagged: 0,
        missing: 0,
        flaggedSigns: [],
        letters: 0,
        typed: 0,
      };

      summary.scans++;
      if (scan.status === 'missing') summary.missing++;
      else summary.located++;
      if (scan.status === 'far') {
        summary.flagged++;
        if (!summary.flaggedSigns.includes(sign.key)) summary.flaggedSigns.push(sign.key);
      }

      byParticipant.set(scan.eq, summary);
    }
  }

  for (const summary of byParticipant.values()) {
    // A card can hold fewer letters than it has scans — an official who cleared
    // a row after the crew handed in — and a negative count says nothing.
    summary.typed = Math.max(0, summary.letters - summary.scans);
  }

  const participants = Array.from(byParticipant.values()).sort(
    (a, b) => b.flagged - a.flagged || b.typed - a.typed || b.missing - a.missing || a.eq - b.eq
  );

  return {
    radiusMeters: radius,
    signs,
    participants,
    totals: {
      scans: signs.reduce((total, sign) => total + sign.scans.length, 0),
      located: signs.reduce((total, sign) => total + sign.located, 0),
      flagged: signs.reduce((total, sign) => total + sign.flagged, 0),
      missing: signs.reduce((total, sign) => total + sign.missing, 0),
      signs: signs.length,
      signsWithoutReference: signs.filter((sign) => sign.referenceSource === 'none').length,
      flaggedParticipants: participants.filter((entry) => entry.flagged > 0).length,
      typed: participants.reduce((total, entry) => total + entry.typed, 0),
    },
  };
}

// --- Presentation ----------------------------------------------------------

export function formatCoordinate(point: GeoPoint): string {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

export function formatDistance(meters: number | null): string {
  if (meters === null) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// A plain link to a map, opened in a new tab. Nothing is embedded: the CSP of
// this app (next.config.ts) does not let a third-party map into the page, and
// an official only needs to see the spot once.
export function mapLink(point: GeoPoint): string {
  return `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=17/${point.latitude}/${point.longitude}`;
}
