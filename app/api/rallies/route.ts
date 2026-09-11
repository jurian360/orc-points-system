import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Rally } from '../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../lib/api-guard';
import { parseName, parseRallyDate } from '../../lib/validation';
import { parseRallyCode, slugFromName } from '../../lib/rallyCodes';

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    await dbConnect();
    // Newest first, and now by the day the rally was *ridden* rather than the
    // day it was typed in: officials set up next month's rally weeks ahead, so
    // creation order stopped being the calendar the moment a rally carried a
    // date. A rally that predates the field sorts on `createdAt`, which is the
    // same fallback every read of the date uses.
    const rallies = await Rally.find({}).sort({ date: -1, createdAt: -1 });
    return NextResponse.json(rallies);
  } catch (error) {
    console.error('Failed to fetch rallies:', error);
    return NextResponse.json({ error: 'Failed to fetch rallies' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const name = parseName(parsed.body.name);
  if (!name) {
    return NextResponse.json(
      { error: 'Rally name is required (1-200 characters)' },
      { status: 400 }
    );
  }

  // Officials name the code themselves. A rally created without one — by an
  // older client, or by somebody who left the field empty — falls back to the
  // suggestion the form would have made, so every rally has a code from the
  // start and the QR pages never have to mint one.
  const code =
    parsed.body.code === undefined || parsed.body.code === ''
      ? slugFromName(name)
      : parseRallyCode(parsed.body.code);

  if (!code) {
    return NextResponse.json(
      { error: 'Rally code must be letters, digits and dashes (up to 32 characters)' },
      { status: 400 }
    );
  }

  // The day the rally is ridden. Required on a new rally, because it is what
  // puts it in a season and a rally that is in no year cannot be won — and
  // because a date guessed from the day somebody happened to type it in would
  // be wrong roughly as often as it was right.
  const date = parseRallyDate(parsed.body.date);
  if (!date) {
    return NextResponse.json(
      { error: 'A rally needs the date it is ridden (YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  // Official unless the request says otherwise: it is both the common case and
  // the safe one. An unofficial rally wrongly counted is a wrong champion, and
  // it takes one tick to prevent.
  const countsForSeason = parsed.body.countsForSeason !== false;

  try {
    await dbConnect();

    const rally = new Rally({ name, code, date, countsForSeason });
    const savedRally = await rally.save();

    return NextResponse.json(savedRally, { status: 201 });
  } catch (error) {
    // The unique index on `code` is what keeps two rallies from answering to
    // the same submission from the app.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'Another rally already uses that code' },
        { status: 409 }
      );
    }

    console.error('Failed to create rally:', error);
    return NextResponse.json({ error: 'Failed to create rally' }, { status: 500 });
  }
}
