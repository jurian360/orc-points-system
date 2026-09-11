import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Participant, Person } from '../../../models';
import { readBody, requirePersonAdmin, requireSession } from '../../../lib/api-guard';
import { hashPassword } from '../../../lib/passwords';
import { toPersonDetail } from '../../../lib/riderResults';
import { EMAIL_RULE, PHONE_RULE } from '../../../lib/persons';
import { PASSWORD_RULE } from '../../../lib/roles';
import {
  parseEmail,
  parseFoodRestrictions,
  parseName,
  parseObjectId,
  parsePassword,
  parsePhone,
} from '../../../lib/validation';

// One rider. Reading is any official's; changing their details is an admin's.
//
// Their **classification** is not editable here: it has a route of its own
// (`./classification`) because a classification admin may change it and
// nothing else, and because changing it writes a history entry rather than
// simply overwriting a field.

function invalidId() {
  return NextResponse.json({ error: 'Invalid member id' }, { status: 400 });
}

// GET /api/persons/[id] — one rider, with their whole classification history.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;
    const personId = parseObjectId(id);
    if (!personId) return invalidId();

    await dbConnect();

    const person = await Person.findById(personId).lean();
    if (!person) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    return NextResponse.json(
      toPersonDetail(person as unknown as Parameters<typeof toPersonDetail>[0])
    );
  } catch (error) {
    console.error('Failed to fetch rider:', error);
    return NextResponse.json({ error: 'Failed to fetch member' }, { status: 500 });
  }
}

// PUT /api/persons/[id] — correct a rider's details.
//
// Only the fields that were sent are changed, so a form that edits a phone
// number does not have to send the address back.
//
// **Changing the e-mail address is an ordinary edit of one field**, and that
// is the point of putting the identity there: no entry, crew, result or
// standing stores an address, so correcting a typo in one updates everything
// that reads the rider. Changing the *name* is the one edit with a tail —
// every entry this rider has ridden carries a copy of it, so those are
// rewritten here (see the model for why the copy exists).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requirePersonAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  try {
    const { id } = await params;
    const personId = parseObjectId(id);
    if (!personId) return invalidId();

    await dbConnect();

    const person = await Person.findById(personId);
    if (!person) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    if (body.email !== undefined) {
      const email = parseEmail(body.email);
      if (!email) {
        return NextResponse.json(
          { error: `Invalid e-mail address. ${EMAIL_RULE}` },
          { status: 400 }
        );
      }
      person.email = email;
    }

    // Held so the entries can be rewritten below, and only when it actually
    // changed: renaming fifty entries on every save of a phone number would be
    // a lot of writing to say nothing.
    let renamedTo: string | null = null;

    if (body.name !== undefined) {
      const name = parseName(body.name);
      if (!name) {
        return NextResponse.json(
          { error: 'A member needs a name (1-200 characters)' },
          { status: 400 }
        );
      }
      if (name !== person.name) renamedTo = name;
      person.name = name;
    }

    if (body.phone !== undefined) {
      const phone = parsePhone(body.phone);
      if (phone === null) {
        return NextResponse.json({ error: `Invalid phone number. ${PHONE_RULE}` }, { status: 400 });
      }
      person.phone = phone;
    }

    if (body.foodRestrictions !== undefined) {
      const foodRestrictions = parseFoodRestrictions(body.foodRestrictions);
      if (foodRestrictions === null) {
        return NextResponse.json(
          { error: 'Food restrictions must be text of at most 500 characters' },
          { status: 400 }
        );
      }
      person.foodRestrictions = foodRestrictions;
    }

    // `null` takes a rider's login away; a string sets or resets it. Both sign
    // their other sessions out, which is the point of a reset.
    if (body.password !== undefined) {
      if (body.password === null || body.password === '') {
        person.passwordHash = null;
        person.passwordChangedAt = new Date();
      } else {
        const password = parsePassword(body.password);
        if (!password) {
          return NextResponse.json(
            { error: `Invalid password. ${PASSWORD_RULE}` },
            { status: 400 }
          );
        }
        person.passwordHash = await hashPassword(password);
        person.passwordChangedAt = new Date();
      }
    }

    person.updatedAt = new Date();
    await person.save();

    // The entries' copies of the name, brought back into line. Two updates
    // because a rider is a driver in some entries and a navigator in others,
    // and one `$or` cannot set two different fields.
    if (renamedTo !== null) {
      await Promise.all([
        Participant.updateMany({ driverId: personId }, { $set: { driverName: renamedTo } }),
        Participant.updateMany({ navigatorId: personId }, { $set: { navigatorName: renamedTo } }),
      ]);
    }

    return NextResponse.json(toPersonDetail(person.toObject()));
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
      return NextResponse.json(
        { error: 'Another member is already registered with that e-mail address' },
        { status: 409 }
      );
    }

    console.error('Failed to save rider:', error);
    return NextResponse.json({ error: 'Failed to save member' }, { status: 500 });
  }
}

// DELETE /api/persons/[id] — remove a rider from the registry.
//
// **Refused while they have ridden anything.** Deleting them would leave every
// entry they are half of naming a rider who does not exist, which silently
// drops their crew out of the overall standings and leaves a result sheet
// half-named. A rider who has ridden is part of the record; the way to stop
// them appearing is to stop entering them, not to erase what they did.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requirePersonAdmin();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;
    const personId = parseObjectId(id);
    if (!personId) return invalidId();

    await dbConnect();

    const person = await Person.findById(personId);
    if (!person) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

    const entries = await Participant.countDocuments({
      $or: [{ driverId: personId }, { navigatorId: personId }],
    });

    if (entries > 0) {
      return NextResponse.json(
        {
          error:
            `This member is entered in ${entries} ${entries === 1 ? 'rally' : 'rallies'} and ` +
            'cannot be deleted. Removing them would leave those entries without a crew.',
        },
        { status: 409 }
      );
    }

    await person.deleteOne();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete rider:', error);
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 });
  }
}
