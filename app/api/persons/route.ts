import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Person } from '../../models';
import { readBody, requirePersonAdmin, requireSession } from '../../lib/api-guard';
import { hashPassword } from '../../lib/passwords';
import { toPersonDetail } from '../../lib/riderResults';
import { EMAIL_RULE, PHONE_RULE } from '../../lib/persons';
import { CLASSIFICATION_LIST } from '../../lib/participants';
import { PASSWORD_RULE } from '../../lib/roles';
import {
  parseClassification,
  parseEmail,
  parseFoodRestrictions,
  parseName,
  parsePassword,
  parsePhone,
} from '../../lib/validation';

// The rider registry: every human being who rides rallies, across every event
// and every season.
//
// **Reading it is any official's** — a data-entry official registering a crew
// has to pick the two riders out of it, and a classification admin works in it
// all day. **Writing it is an admin's**, with one exception that has a route of
// its own: a rider's *classification* moves through
// `PUT /api/persons/[id]/classification`, which a classification admin may
// call and which writes a history entry.
//
// The password hash never leaves this API. Every response goes through
// `toPersonDetail`, which turns it into the boolean `hasLogin` — one function,
// so no handler can leak it by forgetting a projection.

// GET /api/persons — every rider, by name.
//
// The whole registry in one response: two hundred riders of six short fields
// is a few tens of kilobytes, and the pickers that read it want to search
// without a round trip per keystroke. The classification *history* is left out
// here and returned by the detail route — that is the part that grows.
export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const people = await Person.find({}).sort({ name: 1, email: 1 }).lean();

    return NextResponse.json(
      people.map((person) => {
        const { classificationHistory, ...row } = toPersonDetail(
          person as unknown as Parameters<typeof toPersonDetail>[0]
        );
        // Named and discarded rather than never built: `toPersonDetail` is the
        // one place that decides what a rider looks like on the wire, and
        // trimming its output here keeps that true.
        void classificationHistory;
        return row;
      })
    );
  } catch (error) {
    console.error('Failed to fetch riders:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

// POST /api/persons — add a rider.
//
// Creating only. An address that is already registered is a 409, never an
// overwrite: the address *is* the identity, so silently updating whoever holds
// it would be editing a different human being.
export async function POST(request: NextRequest) {
  const session = await requirePersonAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  const email = parseEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: `Invalid e-mail address. ${EMAIL_RULE}` }, { status: 400 });
  }

  const name = parseName(body.name);
  if (!name) {
    return NextResponse.json(
      { error: 'A member needs a name (1-200 characters)' },
      { status: 400 }
    );
  }

  const phone = parsePhone(body.phone);
  if (phone === null) {
    return NextResponse.json({ error: `Invalid phone number. ${PHONE_RULE}` }, { status: 400 });
  }

  const foodRestrictions = parseFoodRestrictions(body.foodRestrictions);
  if (foodRestrictions === null) {
    return NextResponse.json(
      { error: 'Food restrictions must be text of at most 500 characters' },
      { status: 400 }
    );
  }

  // A rider can be given their class as they are added — an admin usually
  // knows it — and that first setting is recorded in the history like any
  // other change, so the record never starts with an unexplained class.
  const classification = parseClassification(body.classification);
  if (classification === null) {
    return NextResponse.json(
      { error: `Classification must be one of ${CLASSIFICATION_LIST}` },
      { status: 400 }
    );
  }

  // Optional: most riders never sign in, and the ones who do are given a
  // password here or later.
  let passwordHash: string | null = null;
  if (body.password !== undefined && body.password !== null && body.password !== '') {
    const password = parsePassword(body.password);
    if (!password) {
      return NextResponse.json({ error: `Invalid password. ${PASSWORD_RULE}` }, { status: 400 });
    }
    passwordHash = await hashPassword(password);
  }

  try {
    await dbConnect();

    const now = new Date();

    const person = await Person.create({
      email,
      name,
      phone,
      foodRestrictions,
      classification,
      classificationChangedAt: classification === '' ? null : now,
      classificationHistory:
        classification === ''
          ? []
          : [{ from: '', to: classification, changedAt: now, changedBy: session.user.username }],
      passwordHash,
      passwordChangedAt: passwordHash ? now : null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json(toPersonDetail(person.toObject()), { status: 201 });
  } catch (error) {
    // The unique index on `email` is the real guard: the address is the
    // identity, and two riders answering to one would make a login ambiguous.
    if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
      return NextResponse.json(
        { error: 'A member with that e-mail address is already registered' },
        { status: 409 }
      );
    }

    console.error('Failed to create rider:', error);
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 });
  }
}
