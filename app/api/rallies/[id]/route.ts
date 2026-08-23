import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Rally, Stage, AnswerSheet, Participant, CardAccess } from '../../../models';
import { readBody, requireSession } from '../../../lib/api-guard';
import { parseName } from '../../../lib/validation';
import { parseRallyCode } from '../../../lib/rallyCodes';
import mongoose from 'mongoose';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const updatedRally = await Rally.findByIdAndUpdate(
      id,
      code ? { name, code } : { name },
      { new: true, runValidators: true }
    );

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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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

    // Cascade: remove the stages, answer sheets, participants and printed QR
    // codes of this rally.
    await Promise.all([
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
