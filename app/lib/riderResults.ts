import 'server-only';

// One rider's history: the rallies they entered, who they rode each of them
// with, and what the crew scored.
//
// It answers two routes — `/api/me/results`, which a rider reads about
// themselves, and `/api/persons/[id]/results`, which an official reads about a
// rider. One module because they are the same question, and a dashboard that
// disagreed with what the official sees would be worse than no dashboard.
//
// Authorisation is the caller's: this takes a person id and returns that
// person's history. `/api/me` passes the id out of the session and nothing
// else, which is what keeps "my results" from becoming "anybody's".

import mongoose from 'mongoose';

import dbConnect from './mongodb';
import { Participant, Person, Rally } from '../models';
import { computeRallyStandings } from './rallyStandings';
import { crewsOfPerson } from './overallStandings';
import { effectiveRallyDate, loadSeasonStandings } from './seasonStandings';
import { isRanked } from './standings';
import { rallyYear } from './seasons';
import { seatOf } from './crews';
import { EMPTY_VEHICLE, type Vehicle } from './persons';
import type { ClassificationValue } from './participants';
import type { PersonDetail, RiderEntry, RiderResults } from '../types';

interface StoredPerson {
  _id: unknown;
  email: string;
  name: string;
  phone?: string;
  foodRestrictions?: string;
  classification?: ClassificationValue;
  classificationChangedAt?: Date | string | null;
  classificationHistory?: {
    from?: ClassificationValue;
    to?: ClassificationValue;
    changedAt?: Date | string;
    changedBy?: string;
  }[];
  passwordHash?: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

// A stored rider in the shape the API hands out. The password hash never
// appears — `hasLogin` is the whole of what a view learns about it — and this
// is the one function that decides that, so no route can leak it by forgetting
// a projection.
export function toPersonDetail(person: StoredPerson): PersonDetail {
  return {
    _id: String(person._id),
    email: person.email,
    name: person.name,
    phone: person.phone || '',
    foodRestrictions: person.foodRestrictions || '',
    classification: person.classification || '',
    classificationChangedAt: person.classificationChangedAt
      ? new Date(person.classificationChangedAt).toISOString()
      : null,
    classificationHistory: (person.classificationHistory || []).map((change) => ({
      from: change.from || '',
      to: change.to || '',
      changedAt: change.changedAt ? new Date(change.changedAt).toISOString() : '',
      changedBy: change.changedBy || '',
    })),
    hasLogin: Boolean(person.passwordHash),
    createdAt: person.createdAt ? new Date(person.createdAt).toISOString() : '',
    updatedAt: person.updatedAt ? new Date(person.updatedAt).toISOString() : '',
  };
}

// `null` means there is no such rider.
export async function loadRiderResults(personId: string): Promise<RiderResults | null> {
  await dbConnect();

  const person = (await Person.findById(personId).lean()) as unknown as StoredPerson | null;
  if (!person) return null;

  // Every entry this rider is half of, in either seat. Two clauses rather than
  // one because a crew is a driver *and* a navigator, and a rider is whichever
  // of the two they sat in that day.
  const entries = (await Participant.find({
    $or: [{ driverId: personId }, { navigatorId: personId }],
  }).lean()) as unknown as {
    rallyId: unknown;
    eq: number;
    driverId?: unknown;
    navigatorId?: unknown;
    classification?: ClassificationValue;
    vehicle?: Vehicle;
    // Only on a rally whose results were imported.
    finishPosition?: number | null;
    resultStatus?: 'finished' | 'dnf' | 'dns' | null;
  }[];

  const rallyIds = Array.from(new Set(entries.map((entry) => String(entry.rallyId))));

  // `mongoose.trusted`: `sanitizeFilter` would otherwise wrap the `$in` in an
  // `$eq` and fail to cast it. The ids came off this rider's own entries.
  const rallies = (await Rally.find(
    { _id: mongoose.trusted({ $in: rallyIds }) },
    'name date countsForSeason resultsImported createdAt'
  ).lean()) as unknown as {
    _id: unknown;
    name: string;
    date?: Date | string | null;
    countsForSeason?: boolean;
    resultsImported?: boolean;
    createdAt?: Date | string | null;
  }[];

  const ralliesById = new Map(rallies.map((rally) => [String(rally._id), rally]));

  // The partners, so an entry can name who the rider rode it with.
  const partnerIds = Array.from(
    new Set(
      entries
        .map((entry) =>
          String(entry.driverId) === personId
            ? entry.navigatorId
            : entry.driverId
        )
        .filter((id): id is NonNullable<typeof id> => Boolean(id))
        .map(String)
    )
  );

  const partners = (await Person.find(
    { _id: mongoose.trusted({ $in: partnerIds }) },
    'name email'
  ).lean()) as unknown as { _id: unknown; name: string; email: string }[];

  const partnersById = new Map(
    partners.map((partner) => [
      String(partner._id),
      { _id: String(partner._id), name: partner.name, email: partner.email },
    ])
  );

  // Each rally's standings, once, so an entry can carry the place and the
  // total the rally itself gave this crew. `computeRallyStandings` is what the
  // rally's own table reads, so a rider's dashboard cannot show a different
  // number from the result sheet on the wall.
  //
  // A rally whose results were **imported** is skipped: it has no cards to
  // score, and its finishing order is on the entry itself.
  const standingsByRally = new Map<string, Awaited<ReturnType<typeof computeRallyStandings>>>();
  for (const rallyId of rallyIds) {
    if (ralliesById.get(rallyId)?.resultsImported) continue;
    standingsByRally.set(rallyId, await computeRallyStandings(rallyId));
  }

  // How big the field of an imported rally was, so a place there reads as
  // "7 of 43" like any other. Counted from the entries the import wrote.
  const importedFieldSize = new Map<string, number>();
  for (const entry of entries) {
    const rallyId = String(entry.rallyId);
    if (!ralliesById.get(rallyId)?.resultsImported) continue;
    importedFieldSize.set(rallyId, (importedFieldSize.get(rallyId) ?? 0) + 1);
  }

  const riderEntries: RiderEntry[] = [];

  for (const entry of entries) {
    const rallyId = String(entry.rallyId);
    const rally = ralliesById.get(rallyId);
    if (!rally) continue;

    const seat = seatOf(
      { driverId: String(entry.driverId ?? ''), navigatorId: String(entry.navigatorId ?? '') },
      personId
    );
    // The query matched on one of the two seats, so this is never null in
    // practice; it is read rather than assumed because the alternative is a
    // dashboard that quietly lists somebody else's entry.
    if (!seat) continue;

    const partnerId = seat === 'driver' ? entry.navigatorId : entry.driverId;

    const resultsImported = rally.resultsImported === true;

    // Two kinds of rally, one shape of answer. An imported one records where
    // the crew came and nothing else; a scored one is read out of its own
    // standings.
    let result: RiderEntry['result'] = null;

    if (resultsImported) {
      const status = entry.resultStatus ?? 'finished';

      result = {
        totalPenalty: null,
        orcPenalty: null,
        timePenalty: null,
        merkPenalty: null,
        status,
        rank: status === 'finished' ? entry.finishPosition ?? 0 : 0,
        fieldSize: importedFieldSize.get(rallyId) ?? 0,
      };
    } else {
      const standings = standingsByRally.get(rallyId);
      const row = standings?.standings.find((candidate) => candidate.eq === entry.eq) ?? null;

      if (row !== null) {
        result = {
          totalPenalty: row.totalPenalty,
          orcPenalty: row.orcPenalty,
          timePenalty: row.timePenalty,
          merkPenalty: row.merkPenalty,
          status: row.status,
          // Only a crew who finished has a place. `rank` on a standings entry
          // is its position in the whole list, DNF's and DNS's included, so it
          // is only a place for the ones that are ranked.
          rank: isRanked(row.status) ? row.rank : 0,
          fieldSize: standings?.standings.length ?? 0,
        };
      }
    }

    riderEntries.push({
      rallyId,
      rallyName: rally.name,
      date: effectiveRallyDate(rally).toISOString(),
      countsForSeason: rally.countsForSeason !== false,
      eq: entry.eq,
      seat,
      partner: partnerId ? partnersById.get(String(partnerId)) ?? null : null,
      classification: entry.classification || '',
      vehicle: entry.vehicle ?? { ...EMPTY_VEHICLE },
      resultsImported,
      result,
    });
  }

  // Newest rally first: a dashboard opens on what just happened.
  riderEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // The rider's crews, per year. Read off the season standings rather than
  // recomputed, so "we are 2 of the 3 rallies we need" on a dashboard is the
  // same arithmetic that decides the championship.
  const years = Array.from(
    new Set(riderEntries.map((entry) => rallyYear(entry.date)))
  ).sort((a, b) => b - a);

  const seasons = [];
  for (const year of years) {
    const season = await loadSeasonStandings(year);
    seasons.push({
      year,
      settings: season.settings,
      crews: crewsOfPerson(season.entries, personId),
    });
  }

  return { person: toPersonDetail(person), entries: riderEntries, seasons };
}
