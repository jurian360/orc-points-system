import 'server-only';

// The overall standings of one rally year, read out of the database.
//
// The *rule* lives in `app/lib/overallStandings.ts`, which is pure and shared
// so the server and the browser group a crew's season identically. This module
// is only the query around it: which rallies are in the year, what each rally's
// own standings gave every crew, and who the riders are.
//
// It **scores nothing**, and it does not re-add a rally either: every total
// here comes out of `computeRallyStandings`, the same function the rally's own
// standings table and printed result sheet are drawn from.

import mongoose from 'mongoose';

import dbConnect from './mongodb';
import { Participant, Person, Rally, Season } from '../models';
import { computeRallyStandings } from './rallyStandings';
import {
  computeOverallStandings,
  type OverallStandings,
  type SeasonRally,
  type SeasonResult,
} from './overallStandings';
import {
  DEFAULT_POINTS_TABLE,
  DEFAULT_TIME_FACTOR,
  defaultSeasonSettings,
  rallyYear,
  sortPointsTable,
  type PointsBand,
  type SeasonSettings,
} from './seasons';
import { isRanked, type StandingsStatus } from './standings';
import type { PersonSummary } from './persons';
import type { ClassificationValue } from './participants';

interface StoredRally {
  _id: unknown;
  name: string;
  date?: Date | string | null;
  countsForSeason?: boolean;
  timeFactor?: number;
  resultsImported?: boolean;
  createdAt?: Date | string | null;
}

// The day a rally counts as having been ridden. A rally created before the
// date field existed falls back to the day it was created, so it lands in its
// own year rather than in none — the read-side half of the model's decision
// not to make `date` required.
export function effectiveRallyDate(rally: StoredRally): Date {
  return new Date(rally.date ?? rally.createdAt ?? Date.now());
}

// The settings of one year: the stored ones, or the defaults for a year nobody
// has configured. There is no "create a season" step, so a missing document is
// a normal year and not a 404.
export async function loadSeasonSettings(year: number): Promise<SeasonSettings> {
  await dbConnect();

  const stored = (await Season.findOne({ year }).lean()) as unknown as
    | (Partial<SeasonSettings> & { pointsTable?: PointsBand[] })
    | null;

  const defaults = defaultSeasonSettings(year);
  if (!stored) return defaults;

  // A stored year that predates the points table — or one saved with an empty
  // one — still reads with the placeholder rather than with no table at all,
  // which would award every position nothing and rank the year flat. The flag
  // is what the standings page puts a warning on.
  const table = stored.pointsTable?.length
    ? sortPointsTable(
        stored.pointsTable.map((band) => ({
          from: band.from,
          to: band.to,
          points: band.points,
        }))
      )
    : DEFAULT_POINTS_TABLE;

  return {
    year,
    countingResults: stored.countingResults ?? defaults.countingResults,
    minimumRallies: stored.minimumRallies ?? defaults.minimumRallies,
    pointsTable: table,
    usingDefaultPointsTable: !stored.pointsTable?.length,
  };
}

// Every year that has a rally in it, newest first. What a year picker offers —
// there is no list of seasons to read, because a season is just the rallies
// that fell in it.
export async function loadSeasonYears(): Promise<number[]> {
  await dbConnect();

  const rallies = (await Rally.find({}, 'date createdAt').lean()) as unknown as StoredRally[];
  const years = new Set(rallies.map((rally) => rallyYear(effectiveRallyDate(rally))));

  return Array.from(years).sort((a, b) => b - a);
}

export interface SeasonStandings extends OverallStandings {
  year: number;
  // How many rallies of the year were left out for being unofficial. Shown, so
  // a reader who counted eight rallies and sees six columns knows why.
  unofficialRallies: number;
}

// The whole of one season: the rallies, every crew's results and the ranking.
export async function loadSeasonStandings(year: number): Promise<SeasonStandings> {
  await dbConnect();

  const settings = await loadSeasonSettings(year);

  // Every rally, filtered to the year in memory rather than with a date range
  // query: a rally that predates the `date` field has to fall back to its
  // `createdAt`, and a range query cannot express that. The club rides ten
  // rallies a year, so the collection is tiny.
  const allRallies = (await Rally.find(
    {},
    'name date countsForSeason timeFactor resultsImported createdAt'
  ).lean()) as unknown as StoredRally[];

  const inYear = allRallies.filter(
    (rally) => rallyYear(effectiveRallyDate(rally)) === year
  );

  const rallies: SeasonRally[] = inYear.map((rally) => ({
    _id: String(rally._id),
    name: rally.name,
    date: effectiveRallyDate(rally).toISOString(),
    // Absent reads as official: the field defaults to true on the model, and a
    // rally that predates it was ridden as a real one.
    countsForSeason: rally.countsForSeason !== false,
    // Absent reads as unweighted, not as worthless.
    timeFactor: rally.timeFactor ?? DEFAULT_TIME_FACTOR,
    resultsImported: rally.resultsImported === true,
  }));

  const counting = rallies.filter((rally) => rally.countsForSeason);
  const unofficialRallies = rallies.length - counting.length;

  // The entry lists of the counting rallies, so a rally total can be attached
  // to the pair of riders who scored it. Keyed `{rallyId}:{eq}` because that is
  // what a standings entry is identified by.
  // `sanitizeFilter` (app/lib/mongodb.ts) wraps any operator that reaches a
  // filter in `$eq`, which would turn this into a cast error. These ids are
  // ours — read out of the rallies a moment ago, never off the wire — so
  // `mongoose.trusted` is the documented opt-out.
  const entries = await Participant.find({
    rallyId: mongoose.trusted({ $in: counting.map((rally) => rally._id) }),
  }).lean();

  type StoredEntry = {
    rallyId: unknown;
    eq: number;
    driverId?: unknown;
    navigatorId?: unknown;
    classification?: ClassificationValue;
    // Only on an imported rally: where the crew finished, and how they ended.
    finishPosition?: number | null;
    resultStatus?: StandingsStatus | null;
  };

  const crewByRallyAndEq = new Map<string, StoredEntry>(
    (entries as unknown as StoredEntry[]).map((entry) => [`${String(entry.rallyId)}:${entry.eq}`, entry])
  );

  // What each crew did in each counting rally. There are two kinds of rally
  // and they answer the same question differently:
  //
  //   * A rally **scored here** is asked for its own standings — the same
  //     `computeRallyStandings` behind its table and its printed sheet — and
  //     the crew's position is the rank those standings give them. Only a crew
  //     who *finished* has one; a DNF or a DNS has no place, which is position
  //     0 and earns nothing.
  //   * A rally whose results were **imported** has no cards to score. Its
  //     finishing order was typed in and lives on the entries themselves
  //     (`finishPosition` / `resultStatus`).
  //
  // Sequential rather than in parallel: ten rallies of fifty crews is a
  // handful of queries each, and firing forty of them at once at one Mongo
  // connection buys nothing worth the burst.
  const results: SeasonResult[] = [];

  // An EQ with no registered crew is not a pair, so it has no season. That is
  // not a gap to paper over: an overall standing is awarded to two named
  // people, and an entry nobody registered names none.
  const crewOf = (entry: StoredEntry | undefined) =>
    entry?.driverId && entry?.navigatorId
      ? {
          driverId: String(entry.driverId),
          navigatorId: String(entry.navigatorId),
          classification: entry.classification || ('' as ClassificationValue),
        }
      : null;

  for (const rally of counting) {
    if (rally.resultsImported) {
      for (const entry of entries as unknown as StoredEntry[]) {
        if (String(entry.rallyId) !== rally._id) continue;

        const crew = crewOf(entry);
        if (!crew) continue;

        const status = entry.resultStatus ?? 'finished';

        results.push({
          rallyId: rally._id,
          eq: entry.eq,
          ...crew,
          // A crew who did not finish has no place, whatever the sheet said.
          position: status === 'finished' ? entry.finishPosition ?? 0 : 0,
          status,
          // An imported rally has a finishing order and no strafpunten. Null
          // rather than 0, so a screen can say "not recorded" instead of
          // showing a perfect score.
          totalPenalty: null,
        });
      }

      continue;
    }

    const standings = await computeRallyStandings(rally._id);
    if (!standings) continue;

    for (const entry of standings.standings) {
      const crew = crewOf(crewByRallyAndEq.get(`${rally._id}:${entry.eq}`));
      if (!crew) continue;

      results.push({
        rallyId: rally._id,
        eq: entry.eq,
        ...crew,
        // `rank` on a standings entry is its position in the whole list, DNF's
        // and DNS's included, so it is only a *place* for the crews that are
        // ranked.
        position: isRanked(entry.status) ? entry.rank : 0,
        status: entry.status,
        totalPenalty: entry.totalPenalty,
      });
    }
  }

  // The riders named by those results, and only those: the registry holds
  // everybody who ever entered, and a season is a fraction of it.
  const personIds = Array.from(
    new Set(results.flatMap((result) => [result.driverId, result.navigatorId]))
  );

  const people = (await Person.find(
    { _id: mongoose.trusted({ $in: personIds }) },
    'email name classification'
  ).lean()) as unknown as { _id: unknown; email: string; name: string; classification?: ClassificationValue }[];

  const persons = new Map<string, PersonSummary>(
    people.map((person) => [
      String(person._id),
      {
        _id: String(person._id),
        email: person.email,
        name: person.name,
        classification: person.classification || '',
      },
    ])
  );

  const overall = computeOverallStandings({ settings, rallies, results, persons });

  return { ...overall, year, unofficialRallies };
}
