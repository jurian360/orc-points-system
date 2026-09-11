import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../../lib/mongodb';
import { Participant, Person, Rally } from '../../../../../models';
import { readBody, requireRallyAdmin } from '../../../../../lib/api-guard';
import { crewClassification, type ClassificationValue } from '../../../../../lib/participants';
import { EMPTY_VEHICLE } from '../../../../../lib/persons';
import {
  MAX_IMPORT_PARTICIPANTS,
  parseEmail,
  parseEq,
  parseOptionalName,
} from '../../../../../lib/validation';
import mongoose from 'mongoose';

// POST /api/rallies/[id]/participants/import
//
// The entry list of a rally in one write. The spreadsheet itself is read in the
// browser (app/lib/spreadsheet.ts) and only the mapped rows arrive here, so this
// stays an ordinary JSON route behind the 256 KB object-only body guard — no
// file upload path, no parser on the server.
//
// **A row with two e-mail addresses is a registration.** Each address is
// looked up in the rider register and created if it is not there yet, so
// importing an entry list registers the crews rather than only naming them —
// which is what lets those entries count towards the season. A row with names
// but no addresses still imports, as an entry with no riders attached that an
// official links afterwards.
//
// A rider who is **already** registered is never overwritten by a sheet: the
// register is the record, and a spreadsheet's spelling of somebody's name is
// not a reason to rewrite it. Only riders this import has to create take their
// name from the file.
//
// All or nothing: one unusable row rejects the whole request. A half-imported
// entry list is worse than none, because the officials cannot see where it
// stopped. Rows are upserted on {rallyId, eq}, so re-importing a corrected sheet
// updates the crews instead of colliding with them.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const rows = parsed.body.participants;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: 'The import is empty — there are no participants to save' },
      { status: 400 }
    );
  }

  // A rally has at most 100 EQ numbers, so anything beyond that is either a
  // mis-mapped column or an attempt to make the server do pointless work.
  if (rows.length > MAX_IMPORT_PARTICIPANTS) {
    return NextResponse.json(
      { error: `An import holds at most ${MAX_IMPORT_PARTICIPANTS} participants` },
      { status: 400 }
    );
  }

  interface ImportedRow {
    eq: number;
    driverName: string;
    driverEmail: string;
    navigatorName: string;
    navigatorEmail: string;
  }

  // Every value is proven to be a scalar of the right shape before it reaches a
  // query — the client-side preview is a convenience, not a guard.
  const participants: ImportedRow[] = [];
  const seenEq = new Set<number>();
  // A rider can only be in one car per rally, and the unique indexes would
  // refuse the second entry halfway through the write. Catching it here keeps
  // the import all-or-nothing and names the row.
  const seenEmail = new Map<string, number>();

  for (const [index, row] of rows.entries()) {
    const raw = (row ?? {}) as Record<string, unknown>;
    const position = index + 1;

    const eq = parseEq(raw.eq);
    if (eq === null) {
      return NextResponse.json(
        { error: `Row ${position}: eq must be an integer between 1 and 100` },
        { status: 400 }
      );
    }

    if (seenEq.has(eq)) {
      return NextResponse.json(
        { error: `Row ${position}: EQ ${eq} appears more than once in this import` },
        { status: 400 }
      );
    }
    seenEq.add(eq);

    const driverName = parseOptionalName(raw.driverName);
    const navigatorName = parseOptionalName(raw.navigatorName);
    if (driverName === null || navigatorName === null) {
      return NextResponse.json(
        { error: `Row ${position}: names must be text of at most 200 characters` },
        { status: 400 }
      );
    }

    // Both addresses or neither: half a crew cannot be grouped across a season,
    // so it is refused rather than stored as a pair with a hole in it.
    const hasDriverEmail = Boolean(raw.driverEmail);
    const hasNavigatorEmail = Boolean(raw.navigatorEmail);

    if (hasDriverEmail !== hasNavigatorEmail) {
      return NextResponse.json(
        { error: `Row ${position}: give an e-mail address for both seats, or for neither` },
        { status: 400 }
      );
    }

    let driverEmail = '';
    let navigatorEmail = '';

    if (hasDriverEmail) {
      const driver = parseEmail(raw.driverEmail);
      const navigator = parseEmail(raw.navigatorEmail);
      if (!driver || !navigator) {
        return NextResponse.json(
          { error: `Row ${position}: that is not an e-mail address` },
          { status: 400 }
        );
      }
      if (driver === navigator) {
        return NextResponse.json(
          { error: `Row ${position}: the driver and the navigator are the same rider` },
          { status: 400 }
        );
      }
      if (!driverName || !navigatorName) {
        return NextResponse.json(
          { error: `Row ${position}: a rider with an e-mail address also needs a name` },
          { status: 400 }
        );
      }

      for (const email of [driver, navigator]) {
        const already = seenEmail.get(email);
        if (already !== undefined) {
          return NextResponse.json(
            {
              error:
                `Row ${position}: ${email} is already entered in this import ` +
                `(row ${already}). A rider can only be in one car.`,
            },
            { status: 400 }
          );
        }
        seenEmail.set(email, position);
      }

      driverEmail = driver;
      navigatorEmail = navigator;
    }

    participants.push({ eq, driverName, driverEmail, navigatorName, navigatorEmail });
  }

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const now = new Date();

    // Resolve the addresses to riders, creating the ones this club has not
    // seen before. Done before the entries are written so a failure here
    // leaves the entry list untouched rather than half-linked.
    const addresses = Array.from(seenEmail.keys());

    // Every address went through `parseEmail` above, so these are proven
    // scalars; `mongoose.trusted` gets the `$in` past `sanitizeFilter`
    // (app/lib/mongodb.ts), which would otherwise wrap it in an `$eq`.
    const existing = (await Person.find(
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

    // The name a new rider is created with, taken from the row that introduced
    // them. A rider already in the register keeps the name they have.
    const newRiders = new Map<string, string>();
    for (const row of participants) {
      if (row.driverEmail && !riders.has(row.driverEmail)) {
        newRiders.set(row.driverEmail, row.driverName);
      }
      if (row.navigatorEmail && !riders.has(row.navigatorEmail)) {
        newRiders.set(row.navigatorEmail, row.navigatorName);
      }
    }

    let ridersCreated = 0;

    if (newRiders.size > 0) {
      const created = await Person.insertMany(
        Array.from(newRiders, ([email, name]) => ({
          email,
          name,
          // No class: a class belongs to a rider and is set in the register,
          // where it carries a history. A new rider starts without one and a
          // classification admin gives them theirs.
          classification: '',
          createdAt: now,
          updatedAt: now,
        })),
        // The whole import is refused if one rider cannot be created, rather
        // than writing an entry list that is missing a rider nobody noticed.
        { ordered: true }
      );

      ridersCreated = created.length;

      for (const person of created) {
        riders.set(person.email, { _id: String(person._id), classification: '' });
      }
    }

    const result = await Participant.bulkWrite(
      participants.map((participant) => {
        const driver = participant.driverEmail
          ? riders.get(participant.driverEmail)
          : undefined;
        const navigator = participant.navigatorEmail
          ? riders.get(participant.navigatorEmail)
          : undefined;

        const driverClassification = driver?.classification || '';
        const navigatorClassification = navigator?.classification || '';

        return {
          updateOne: {
            filter: { rallyId: id, eq: participant.eq },
            update: {
              $set: {
                driverId: driver?._id ?? null,
                navigatorId: navigator?._id ?? null,
                driverName: participant.driverName,
                navigatorName: participant.navigatorName,
                driverClassification,
                navigatorClassification,
                // Derived here exactly as it is on the entry form: the higher
                // of the two riders' classes.
                classification: crewClassification(
                  driverClassification,
                  navigatorClassification
                ),
                updatedAt: now,
              },
              // The car is not on an entry list, so an import never touches it
              // — but a brand-new entry needs one to exist.
              $setOnInsert: { createdAt: now, vehicle: { ...EMPTY_VEHICLE } },
            },
            upsert: true,
          },
        };
      })
    );

    // Nothing is re-scored: a participant record carries no points, so the
    // standings only gain the crews they show next to the EQ numbers.
    return NextResponse.json({
      message: 'Participants imported successfully',
      total: participants.length,
      created: result.upsertedCount ?? 0,
      updated: result.matchedCount ?? 0,
      // How many riders this import had to add to the register, so an official
      // can tell "the club grew by 12" from "everybody was already known".
      ridersCreated,
      crews: participants.filter((participant) => participant.driverEmail).length,
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
      return NextResponse.json(
        {
          error:
            'A rider in this list is already entered in this rally under another EQ number. ' +
            'Nothing was imported.',
        },
        { status: 409 }
      );
    }

    console.error('Failed to import participants:', error);
    return NextResponse.json({ error: 'Failed to import participants' }, { status: 500 });
  }
}
