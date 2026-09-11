import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../../lib/mongodb';
import { AnswerSheet, Participant, Person, Rally, Stage } from '../../../../../models';
import { readBody, requireRallyAdmin } from '../../../../../lib/api-guard';
import { CLASSIFICATION_LIST, crewClassification } from '../../../../../lib/participants';
import { EMPTY_VEHICLE } from '../../../../../lib/persons';
import type { ClassificationValue } from '../../../../../lib/participants';
import type { StandingsStatus } from '../../../../../lib/standings';
import {
  MAX_IMPORT_PARTICIPANTS,
  parseClassification,
  parseEmail,
  parseFinishPosition,
  parseName,
  parseObjectId,
} from '../../../../../lib/validation';

// POST /api/rallies/[id]/results/import
//
// The **finished result** of a rally the club rode before this system existed:
// a finishing order, the two riders in each car and their classes. There are
// no answer sheets and no score keys behind it — those rallies were scored on
// paper — so nothing here is re-scored and nothing can be. A rally imported
// this way carries its finishing order, which is all the overall standings
// need: a season is ranked on positions (app/lib/seasons.ts).
//
// Three things this route does that the entry-list import does not:
//
//   * **It marks the rally `resultsImported`**, after which the rally may not
//     be given stages or answer sheets. Two sources of truth for one rally's
//     result is exactly the disagreement this codebase is organised to
//     prevent.
//   * **It replaces the rally's entry list** rather than upserting onto it. A
//     result sheet is the whole field in finishing order; merging it into
//     whatever was there would leave crews from a previous import stranded
//     with positions that no longer exist. Re-importing a corrected sheet
//     therefore just works.
//   * **It fills in a rider's missing class** from the sheet, recorded as a
//     dated history entry like any other change. A rider who already has a
//     class keeps it: a historical sheet must not undo a later promotion.
//
// All or nothing, like every import here: one unusable row rejects the whole
// request, because a half-imported result is worse than none.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const rows = parsed.body.results;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: 'The import is empty — there are no results to save' },
      { status: 400 }
    );
  }

  // An EQ number is 1..100 on the model, and this route hands them out itself
  // (see below), so a bigger field than that has nowhere to put its crews.
  if (rows.length > MAX_IMPORT_PARTICIPANTS) {
    return NextResponse.json(
      { error: `An import holds at most ${MAX_IMPORT_PARTICIPANTS} crews` },
      { status: 400 }
    );
  }

  interface ImportedResult {
    position: number;
    status: StandingsStatus;
    driverName: string;
    driverEmail: string;
    driverClassification: ClassificationValue;
    navigatorName: string;
    navigatorEmail: string;
    navigatorClassification: ClassificationValue;
  }

  const results: ImportedResult[] = [];
  // A rider rides one car, and two crews cannot share a place. Both are caught
  // before anything is written, so the refusal names the row rather than
  // arriving as a half-finished import.
  const seenEmail = new Map<string, number>();
  const seenPosition = new Map<number, number>();

  for (const [index, row] of rows.entries()) {
    const raw = (row ?? {}) as Record<string, unknown>;
    const position = index + 1;

    const status = raw.status;
    if (status !== 'finished' && status !== 'dnf' && status !== 'dns') {
      return NextResponse.json(
        { error: `Row ${position}: a result is finished, dnf or dns` },
        { status: 400 }
      );
    }

    // A crew who finished has a place; one who did not has none, and sending a
    // place for them would put a DNF on the podium.
    let finishPosition = 0;
    if (status === 'finished') {
      const place = parseFinishPosition(raw.position);
      if (place === null) {
        return NextResponse.json(
          { error: `Row ${position}: the finish position must be a whole number from 1` },
          { status: 400 }
        );
      }

      const clash = seenPosition.get(place);
      if (clash !== undefined) {
        return NextResponse.json(
          { error: `Row ${position}: position ${place} is already taken by row ${clash}` },
          { status: 400 }
        );
      }
      seenPosition.set(place, position);
      finishPosition = place;
    }

    const driverName = parseName(raw.driverName);
    const navigatorName = parseName(raw.navigatorName);
    if (!driverName || !navigatorName) {
      return NextResponse.json(
        { error: `Row ${position}: a result needs both names` },
        { status: 400 }
      );
    }

    const driverEmail = parseEmail(raw.driverEmail);
    const navigatorEmail = parseEmail(raw.navigatorEmail);
    if (!driverEmail || !navigatorEmail) {
      return NextResponse.json(
        { error: `Row ${position}: a result needs an e-mail address for both seats` },
        { status: 400 }
      );
    }

    if (driverEmail === navigatorEmail) {
      return NextResponse.json(
        { error: `Row ${position}: the driver and the navigator are the same rider` },
        { status: 400 }
      );
    }

    for (const email of [driverEmail, navigatorEmail]) {
      const clash = seenEmail.get(email);
      if (clash !== undefined) {
        return NextResponse.json(
          {
            error:
              `Row ${position}: ${email} is already in this import (row ${clash}). ` +
              'A rider can only be in one car.',
          },
          { status: 400 }
        );
      }
      seenEmail.set(email, position);
    }

    const driverClassification = parseClassification(raw.driverClassification);
    const navigatorClassification = parseClassification(raw.navigatorClassification);
    if (driverClassification === null || navigatorClassification === null) {
      return NextResponse.json(
        { error: `Row ${position}: a class must be one of ${CLASSIFICATION_LIST}` },
        { status: 400 }
      );
    }

    results.push({
      position: finishPosition,
      status,
      driverName,
      driverEmail,
      driverClassification,
      navigatorName,
      navigatorEmail,
      navigatorClassification,
    });
  }

  try {
    const { id } = await params;

    const rallyId = parseObjectId(id);
    if (!rallyId) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const rally = await Rally.findById(rallyId);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    // A rally is scored here or imported, never both. Checked against what the
    // rally actually holds rather than against its own flag, so a rally that
    // was part-way set up cannot be turned into an imported one behind an
    // official's back.
    const [stageCount, sheetCount] = await Promise.all([
      Stage.countDocuments({ rallyId }),
      AnswerSheet.countDocuments({ rallyId }),
    ]);

    if (stageCount > 0 || sheetCount > 0) {
      return NextResponse.json(
        {
          error:
            'This rally is scored in this system — it has ' +
            `${stageCount} stage${stageCount === 1 ? '' : 's'} and ` +
            `${sheetCount} answer sheet${sheetCount === 1 ? '' : 's'}. ` +
            'Import a result only into a rally that was ridden before this system.',
        },
        { status: 409 }
      );
    }

    const now = new Date();

    // --- The riders -------------------------------------------------------
    //
    // Resolved before anything is written, so a failure here leaves the rally
    // untouched rather than half-imported.
    const addresses = Array.from(seenEmail.keys());

    const existing = (await Person.find(
      // `mongoose.trusted`: `sanitizeFilter` (app/lib/mongodb.ts) would wrap
      // the `$in` in an `$eq` and fail to cast it. Every address went through
      // `parseEmail` above, so these are proven scalars.
      { email: mongoose.trusted({ $in: addresses }) },
      'email name classification'
    ).lean()) as unknown as {
      _id: unknown;
      email: string;
      name: string;
      classification?: ClassificationValue;
    }[];

    const riders = new Map<string, { _id: string; classification: ClassificationValue }>(
      existing.map((person) => [
        person.email,
        { _id: String(person._id), classification: person.classification || '' },
      ])
    );

    // The class the sheet gives each address, so a rider named in two seats of
    // the file (which is refused above) or created below takes theirs.
    const classFromSheet = new Map<string, ClassificationValue>();
    const nameFromSheet = new Map<string, string>();
    for (const result of results) {
      classFromSheet.set(result.driverEmail, result.driverClassification);
      classFromSheet.set(result.navigatorEmail, result.navigatorClassification);
      nameFromSheet.set(result.driverEmail, result.driverName);
      nameFromSheet.set(result.navigatorEmail, result.navigatorName);
    }

    const newAddresses = addresses.filter((email) => !riders.has(email));

    let ridersCreated = 0;

    if (newAddresses.length > 0) {
      const created = await Person.insertMany(
        newAddresses.map((email) => {
          const classification = classFromSheet.get(email) || '';

          return {
            email,
            name: nameFromSheet.get(email) || email,
            classification,
            // The first class a rider is given is recorded like any other
            // change, so the record never starts with an unexplained class.
            classificationChangedAt: classification === '' ? null : now,
            classificationHistory:
              classification === ''
                ? []
                : [
                    {
                      from: '',
                      to: classification,
                      changedAt: now,
                      changedBy: session.user.username,
                    },
                  ],
            createdAt: now,
            updatedAt: now,
          };
        }),
        { ordered: true }
      );

      ridersCreated = created.length;

      for (const person of created) {
        riders.set(person.email, {
          _id: String(person._id),
          classification: person.classification || '',
        });
      }
    }

    // A rider already in the register who has **no class yet** takes the one
    // on the sheet. One who has a class keeps it: a result from 2023 must not
    // undo a promotion made in 2025.
    let classificationsFilled = 0;

    for (const [email, rider] of riders) {
      if (rider.classification !== '') continue;

      const classification = classFromSheet.get(email) || '';
      if (classification === '') continue;

      await Person.updateOne(
        { _id: rider._id },
        {
          $set: {
            classification,
            classificationChangedAt: now,
            updatedAt: now,
          },
          $push: {
            classificationHistory: {
              from: '',
              to: classification,
              changedAt: now,
              changedBy: session.user.username,
            },
          },
        }
      );

      rider.classification = classification;
      classificationsFilled += 1;
    }

    // --- The entries ------------------------------------------------------
    //
    // In finishing order, the crews who did not finish behind them. The EQ
    // number is **assigned here**: a rally ridden on paper has no card, so
    // there is no number the crew wore for this app to know. It is a row
    // number in finishing order, and it is what the rest of the app addresses
    // this entry by.
    const ordered = [...results].sort((a, b) => {
      if (a.status !== b.status) {
        const rank = { finished: 0, dnf: 1, dns: 2 } as const;
        return rank[a.status] - rank[b.status];
      }
      return a.position - b.position;
    });

    const entries = ordered.map((result, index) => {
      const driver = riders.get(result.driverEmail);
      const navigator = riders.get(result.navigatorEmail);

      const driverClassification = driver?.classification || '';
      const navigatorClassification = navigator?.classification || '';

      return {
        rallyId,
        eq: index + 1,
        driverId: driver?._id ?? null,
        navigatorId: navigator?._id ?? null,
        driverName: result.driverName,
        navigatorName: result.navigatorName,
        driverClassification,
        navigatorClassification,
        // Derived from the two riders exactly as a registered crew's is. The
        // sheet's own crew-class column is a cross-check in the preview and
        // is never stored.
        classification: crewClassification(driverClassification, navigatorClassification),
        // A rally ridden on paper records no car.
        vehicle: { ...EMPTY_VEHICLE },
        finishPosition: result.status === 'finished' ? result.position : null,
        resultStatus: result.status,
        createdAt: now,
        updatedAt: now,
      };
    });

    // Replace rather than merge: a result sheet is the whole field, and a crew
    // left over from a previous import would keep a position this one does not
    // give them. Safe because an imported rally has no answer sheets to lose.
    await Participant.deleteMany({ rallyId });
    await Participant.insertMany(entries, { ordered: true });

    // From here on this rally is an imported one: no stages, no cards.
    rally.resultsImported = true;
    await rally.save();

    return NextResponse.json({
      message: 'Results imported successfully',
      total: entries.length,
      finishers: entries.filter((entry) => entry.resultStatus === 'finished').length,
      ridersCreated,
      classificationsFilled,
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
      return NextResponse.json(
        {
          error:
            'A rider in this sheet is entered twice in this rally. Nothing was imported.',
        },
        { status: 409 }
      );
    }

    console.error('Failed to import results:', error);
    return NextResponse.json({ error: 'Failed to import results' }, { status: 500 });
  }
}
