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
import { defaultSeasonSettings, rallyYear, type SeasonSettings } from './seasons';
import type { PersonSummary } from './persons';
import type { ClassificationValue } from './participants';

interface StoredRally {
  _id: unknown;
  name: string;
  date?: Date | string | null;
  countsForSeason?: boolean;
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

  const stored = (await Season.findOne({ year }).lean()) as unknown as SeasonSettings | null;
  if (!stored) return defaultSeasonSettings(year);

  return {
    year,
    countingResults: stored.countingResults ?? 0,
    minimumRallies: stored.minimumRallies ?? defaultSeasonSettings(year).minimumRallies,
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
    'name date countsForSeason createdAt'
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
  };

  const crewByRallyAndEq = new Map<string, StoredEntry>(
    (entries as unknown as StoredEntry[]).map((entry) => [`${String(entry.rallyId)}:${entry.eq}`, entry])
  );

  // Each counting rally's own standings — the same numbers its table and its
  // printed result sheet show. Sequential rather than in parallel: ten rallies
  // of fifty crews is a handful of queries each, and firing forty of them at
  // once at one Mongo connection buys nothing worth the burst.
  const results: SeasonResult[] = [];

  for (const rally of counting) {
    const standings = await computeRallyStandings(rally._id);
    if (!standings) continue;

    for (const entry of standings.standings) {
      const crew = crewByRallyAndEq.get(`${rally._id}:${entry.eq}`);

      // An EQ with no registered crew is not a pair, so it has no season. That
      // is not a gap to paper over: an overall standing is awarded to two named
      // people, and an entry nobody registered names none.
      if (!crew?.driverId || !crew?.navigatorId) continue;

      results.push({
        rallyId: rally._id,
        eq: entry.eq,
        driverId: String(crew.driverId),
        navigatorId: String(crew.navigatorId),
        classification: crew.classification || '',
        totalPenalty: entry.totalPenalty,
        status: entry.status,
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
