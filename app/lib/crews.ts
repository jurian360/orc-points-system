// A **crew**: the two people in one car. The driver and the navigator.
//
// A crew is an *unordered pair*. Jan driving with Piet navigating and Piet
// driving with Jan navigating are the same crew — they rode the season
// together, and which seat each of them took on a given Sunday is a detail of
// that entry, not a different partnership. That is the whole content of
// `crewKey` below, and it is why the key sorts its two ids before joining them.
//
// Nothing stores a crew. A crew is not a document: it is what you get when you
// read a season's registrations and notice the same two people in a car three
// times. Storing it would be a second place for the pairing to disagree with
// the entries it is derived from — the same reason `routeTotals` is derived in
// `app/lib/routes.ts` rather than written onto a rally.
//
// Pure and shared, client + server: the overall standings are computed on the
// server and the participant's own dashboard groups their partners in the
// browser, and the two must group them identically.

import { crewClassification, type ClassificationValue } from './participants';
import { personLabel, type PersonSummary } from './persons';

// The stable identity of the pair `a`/`b`, whichever way round they sat.
//
// Sorting the two ids is what makes it unordered, and it is the only reason
// this is a function rather than a template string at each call site: an
// implementation that forgot to sort would silently split a crew's season in
// two and drop both halves below the three-rally threshold.
export function crewKey(a: string, b: string): string {
  return [a, b].sort().join('+');
}

// The two people of one entry, as the registration records them.
export interface CrewMembers {
  driver: PersonSummary;
  navigator: PersonSummary;
}

// The pair's key, read off a registration.
export function crewKeyOf(crew: {
  driverId: string;
  navigatorId: string;
}): string {
  return crewKey(crew.driverId, crew.navigatorId);
}

// The class this crew rides in: the higher of its two members', on `B < A < H`
// (see `crewClassification` in app/lib/participants.ts). Derived here rather
// than typed on the entry, so promoting a rider moves every crew they are half
// of the moment their own record changes.
export function crewClassificationOf(crew: CrewMembers): ClassificationValue {
  return crewClassification(crew.driver.classification, crew.navigator.classification);
}

// "Jan Jansen / Piet Peters" — the driver first, because that is how a crew is
// written on an entry list and on a result sheet. The *pair* is unordered; the
// way one entry is written down is not.
export function crewLabelOf(crew: CrewMembers): string {
  return [personLabel(crew.driver), personLabel(crew.navigator)].filter(Boolean).join(' / ');
}

// The same two people, named in a stable order regardless of who drove. Used
// where a crew is named across a whole season and there is no one entry to take
// the seating from — the overall standings, and a participant's list of the
// partners they rode with.
export function seasonCrewLabel(members: PersonSummary[]): string {
  return members
    .map((member) => personLabel(member))
    .sort((a, b) => a.localeCompare(b))
    .join(' / ');
}

// The other half of a crew, seen from `personId`. Null when the id is not in
// this pair — a participant's dashboard asks this of every entry it holds, and
// an entry that is not theirs has no partner to name.
export function partnerOf(
  crew: { driverId: string; navigatorId: string },
  personId: string
): string | null {
  if (crew.driverId === personId) return crew.navigatorId;
  if (crew.navigatorId === personId) return crew.driverId;
  return null;
}

// Which seat `personId` took in this entry, for a dashboard that lists a
// season as "drove 3, navigated 2".
export type CrewSeat = 'driver' | 'navigator';

export function seatOf(
  crew: { driverId: string; navigatorId: string },
  personId: string
): CrewSeat | null {
  if (crew.driverId === personId) return 'driver';
  if (crew.navigatorId === personId) return 'navigator';
  return null;
}

export const SEAT_LABEL: Record<CrewSeat, string> = {
  driver: 'Bestuurder',
  navigator: 'Navigator',
};
