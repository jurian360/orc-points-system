import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Rally, Route, Stage, AnswerSheet, Participant, CardAccess } from '../../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../../lib/api-guard';
import { parseName, parseRallyDate, parseTimeFactor } from '../../../lib/validation';
import { parseRallyCode } from '../../../lib/rallyCodes';
import mongoose from 'mongoose';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const rally = await Rally.findById(id);

    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    return NextResponse.json(rally);
  } catch (error) {
    console.error('Failed to fetch rally:', error);
    return NextResponse.json({ error: 'Failed to fetch rally' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  // The code is optional in the body so a caller that only renames the rally
  // cannot accidentally clear it — a rally with no code cannot be scanned into
  // the app at all. Omitting it leaves the stored one alone.
  const changesCode = parsed.body.code !== undefined;
  const code = changesCode ? parseRallyCode(parsed.body.code) : null;

  if (changesCode && !code) {
    return NextResponse.json(
      { error: 'Rally code must be letters, digits and dashes (up to 32 characters)' },
      { status: 400 }
    );
  }

  // The date and the season flag are optional for the same reason the code is:
  // a caller that only renames the rally must not be able to clear them by
  // omission. Moving a rally to another date *can* move it into another
  // season, and moving the flag changes whether it counts at all — both are
  // deliberate edits, so both are only made when the body asks for them.
  const changesDate = parsed.body.date !== undefined;
  const date = changesDate ? parseRallyDate(parsed.body.date) : null;

  if (changesDate && !date) {
    return NextResponse.json(
      { error: 'The rally date must be a date (YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  const changesSeasonFlag = parsed.body.countsForSeason !== undefined;
  if (changesSeasonFlag && typeof parsed.body.countsForSeason !== 'boolean') {
    return NextResponse.json(
      { error: 'countsForSeason must be true or false' },
      { status: 400 }
    );
  }

  // Optional like the rest: a caller that only renames the rally must not be
  // able to reweight the whole season by omission.
  const changesTimeFactor = parsed.body.timeFactor !== undefined;
  const timeFactor = changesTimeFactor ? parseTimeFactor(parsed.body.timeFactor) : null;

  if (changesTimeFactor && timeFactor === null) {
    return NextResponse.json(
      { error: 'The time factor must be a number greater than 0 (1 is an ordinary rally)' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const update: Record<string, unknown> = { name };
    if (code) update.code = code;
    if (date) update.date = date;
    if (changesSeasonFlag) update.countsForSeason = parsed.body.countsForSeason;
    if (timeFactor !== null) update.timeFactor = timeFactor;

    const updatedRally = await Rally.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    });

    if (!updatedRally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    return NextResponse.json(updatedRally);
  } catch (error) {
    // Two rallies answering to one code would make a submission from the app
    // ambiguous, so the unique index refuses it.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'Another rally already uses that code' },
        { status: 409 }
      );
    }

    console.error('Failed to update rally:', error);
    return NextResponse.json({ error: 'Failed to update rally' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const deletedRally = await Rally.findByIdAndDelete(id);

    if (!deletedRally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    // Cascade: remove the routes, stages, answer sheets, participants and
    // printed QR codes of this rally.
    await Promise.all([
      Route.deleteMany({ rallyId: id }),
      Stage.deleteMany({ rallyId: id }),
      AnswerSheet.deleteMany({ rallyId: id }),
      Participant.deleteMany({ rallyId: id }),
      CardAccess.deleteMany({ rallyId: id }),
    ]);

    return NextResponse.json({ message: 'Rally deleted successfully' });
  } catch (error) {
    console.error('Failed to delete rally:', error);
    return NextResponse.json({ error: 'Failed to delete rally' }, { status: 500 });
  }
}
