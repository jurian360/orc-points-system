// The **overall standings**: who won the year.
//
// A rally is won by a car on the day. A season is won by a *crew* — the same
// two people, turning up together often enough to have ridden the year rather
// than dropped in on it. That is the whole shape of this module:
//
//   1. Take the season's rallies, minus the ones that do not count
//      (`Rally.countsForSeason`, the unofficial rits).
//   2. Group every entry of those rallies by the **pair of people** in the car,
//      not by the EQ number, which is handed out fresh each rally, and not by
//      the seating, which a crew swaps (see app/lib/crews.ts).
//   3. Drop the pairs who rode fewer than the season's minimum together. One
//      person can be in several pairs and be placed in each of them — riding
//      three rallies with Jan and three with Piet is two crews, and both of
//      them are real.
//   4. Add up each crew's counting results and rank on the total, lowest first,
//      exactly as a rally is.
//
// It **scores nothing**. Every number here is a rally total that
// `app/lib/rescore.ts` already wrote and the rally standings already added up;
// this only decides which of them count and how they are grouped. That is the
// same rule the printed result sheet follows, and for the same reason: a second
// place that computes a penalty is a second place for it to disagree.
//
// Pure and shared, client + server.

import { crewKey } from './crews';
import { classificationRank, type ClassificationValue } from './participants';
import { personLabel, type PersonSummary } from './persons';
import { ALL_RESULTS, type SeasonSettings } from './seasons';
import type { StandingsStatus } from './standings';

// One rally of the season, as the overall standings need it.
export interface SeasonRally {
  _id: string;
  name: string;
  date: string;
  // False for an unofficial rally. Those are filtered out here rather than by
  // the caller, so no view can accidentally count one.
  countsForSeason: boolean;
}

// What one crew scored in one rally: their entry, plus the total the rally's
// own standings gave them.
export interface SeasonResult {
  rallyId: string;
  eq: number;
  driverId: string;
  navigatorId: string;
  // The class the crew rode this rally in — the higher of its two members'
  // classes as they stood that day (app/lib/participants.ts).
  classification: ClassificationValue;
  totalPenalty: number;
  status: StandingsStatus;
}

// A crew's result in one counted (or uncounted) rally of the season.
export interface CrewSeasonResult {
  rallyId: string;
  rallyName: string;
  date: string;
  eq: number;
  totalPenalty: number;
  status: StandingsStatus;
  // False for a result the counting rule left out — a crew's fourth-best rally
  // in a season that counts three. It is still shown: an official reading the
  // sheet wants to see what was dropped, not a gap.
  counted: boolean;
}

export interface CrewSeasonEntry {
  crewKey: string;
  // The two people, in a stable order. A crew is an unordered pair, so this is
  // sorted by name rather than by seat — the seat is a property of each entry
  // and is in `results`.
  members: PersonSummary[];
  label: string;
  // The highest class the crew rode in during the season. A crew promoted
  // half-way through rides the season out in the class they were promoted to:
  // you cannot win B after being moved up to A.
  classification: ClassificationValue;
  results: CrewSeasonResult[];
  // How many official rallies this pair rode together. What the minimum is
  // measured against, and it counts rallies they *started* — a DNS is an entry,
  // not a ride.
  ralliesRidden: number;
  // The sum of the counted results. The number the ranking is on.
  totalPenalty: number;
  countedResults: number;
  // False for a crew short of the season's minimum. They are kept and listed
  // behind the ranked crews rather than dropped: a pair who rode two rallies
  // together should be able to see that they were one short.
  eligible: boolean;
  // 0 for an ineligible crew — only a placed crew has a place, the same rule
  // the rally result sheet follows for a DNF.
  rank: number;
}

// A crew *started* a rally when they have a card in it. A DNS is an entry on
// the list and nothing more, so it neither counts towards the three nor brings
// a blank-card total into the season total — a crew who stayed home should not
// be charged for a rally they could not have scored in.
function started(status: StandingsStatus): boolean {
  return status !== 'dns';
}

// The higher of two classes on `B < A < H`; an unranked class never displaces a
// ranked one. Same rule as a crew's own class, applied across a season.
function higherClassification(
  current: ClassificationValue,
  candidate: ClassificationValue
): ClassificationValue {
  const currentRank = classificationRank(current);
  const candidateRank = classificationRank(candidate);
  if (candidateRank === null) return current || candidate;
  if (currentRank === null) return candidate;
  return candidateRank > currentRank ? candidate : current;
}

export interface OverallStandingsInput {
  settings: SeasonSettings;
  rallies: SeasonRally[];
  results: SeasonResult[];
  // Every person named by a result, by id. A result naming somebody who is not
  // here is dropped: a crew half of whom cannot be identified is not a crew.
  persons: Map<string, PersonSummary>;
}

export interface OverallStandings {
  settings: SeasonSettings;
  // The rallies that counted, in the order they were ridden. The unofficial
  // ones are not here at all.
  rallies: SeasonRally[];
  entries: CrewSeasonEntry[];
}

export function computeOverallStandings({
  settings,
  rallies,
  results,
  persons,
}: OverallStandingsInput): OverallStandings {
  // Only the official rallies, oldest first: the season reads left to right.
  const counting = rallies
    .filter((rally) => rally.countsForSeason)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const ralliesById = new Map(counting.map((rally) => [rally._id, rally]));

  type Draft = {
    crewKey: string;
    members: PersonSummary[];
    classification: ClassificationValue;
    results: CrewSeasonResult[];
  };

  const drafts = new Map<string, Draft>();

  for (const result of results) {
    const rally = ralliesById.get(result.rallyId);
    // Not one of the season's counting rallies — an unofficial rit, or a rally
    // of another year that came along with the query.
    if (!rally) continue;

    const driver = persons.get(result.driverId);
    const navigator = persons.get(result.navigatorId);
    if (!driver || !navigator) continue;

    // A person cannot crew with themselves. A registration that says so is a
    // data error, and counting it would give that "pair" a season of its own.
    if (driver._id === navigator._id) continue;

    const key = crewKey(result.driverId, result.navigatorId);

    let draft = drafts.get(key);
    if (!draft) {
      draft = {
        crewKey: key,
        members: [driver, navigator].sort((a, b) =>
          personLabel(a).localeCompare(personLabel(b))
        ),
        classification: '',
        results: [],
      };
      drafts.set(key, draft);
    }

    draft.classification = higherClassification(draft.classification, result.classification);
    draft.results.push({
      rallyId: rally._id,
      rallyName: rally.name,
      date: rally.date,
      eq: result.eq,
      totalPenalty: result.totalPenalty,
      status: result.status,
      // Decided below, once the crew's whole season is in hand: which results
      // count depends on the others.
      counted: false,
    });
  }

  const entries: CrewSeasonEntry[] = [];

  for (const draft of drafts.values()) {
    // A crew's season, in the order it was ridden.
    draft.results.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const ridden = draft.results.filter((result) => started(result.status));
    const eligible = ridden.length >= settings.minimumRallies;

    // The counting rule: every rally they started, or their best N of them.
    // `slice` over a copy sorted on points, so the crew's own list keeps its
    // riding order and only the flag moves.
    const byPoints = [...ridden].sort(
      (a, b) => a.totalPenalty - b.totalPenalty || a.date.localeCompare(b.date)
    );
    const counted =
      settings.countingResults === ALL_RESULTS
        ? byPoints
        : byPoints.slice(0, settings.countingResults);

    const countedIds = new Set(counted.map((result) => result.rallyId));
    for (const result of draft.results) {
      result.counted = started(result.status) && countedIds.has(result.rallyId);
    }

    entries.push({
      crewKey: draft.crewKey,
      members: draft.members,
      label: draft.members.map((member) => personLabel(member)).join(' / '),
      classification: draft.classification,
      results: draft.results,
      ralliesRidden: ridden.length,
      totalPenalty: counted.reduce((sum, result) => sum + result.totalPenalty, 0),
      countedResults: counted.length,
      eligible,
      rank: 0,
    });
  }

  // The placed crews first, lowest total wins. Behind them the crews who are
  // short of the minimum, ordered so the ones closest to qualifying are on top
  // — that list is read as "who nearly made it".
  entries.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      (a.eligible
        ? a.totalPenalty - b.totalPenalty || b.ralliesRidden - a.ralliesRidden
        : b.ralliesRidden - a.ralliesRidden || a.totalPenalty - b.totalPenalty) ||
      a.label.localeCompare(b.label)
  );

  let place = 0;
  for (const entry of entries) {
    entry.rank = entry.eligible ? ++place : 0;
  }

  return { settings, rallies: counting, entries };
}

// The same standings read for one class, re-numbered 1, 2, 3. A class rides
// against its own class, exactly as on the printed rally result sheet — and
// like that sheet this re-ranks what it filters rather than asking for a second
// ranking, so the two orders cannot disagree.
export function classStandings(
  entries: CrewSeasonEntry[],
  classification: ClassificationValue
): CrewSeasonEntry[] {
  let place = 0;
  return entries
    .filter((entry) => entry.classification === classification)
    .map((entry) => ({ ...entry, rank: entry.eligible ? ++place : 0 }));
}

// Every crew a person rode in this season, in the order they first rode them.
// A participant's dashboard is this question: "who did I ride with, and how did
// we do".
export function crewsOfPerson(
  entries: CrewSeasonEntry[],
  personId: string
): CrewSeasonEntry[] {
  return entries.filter((entry) => entry.members.some((member) => member._id === personId));
}

// Sort order for the results of one crew, newest rally first — how a dashboard
// lists a season.
export function byMostRecent(a: CrewSeasonResult, b: CrewSeasonResult): number {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}
