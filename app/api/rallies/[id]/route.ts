import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Rally, Stage, AnswerSheet } from '../../../models';
import { readBody, requireSession } from '../../../lib/api-guard';
import { parseName } from '../../../lib/validation';
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

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const updatedRally = await Rally.findByIdAndUpdate(
      id,
      { name },
      { new: true, runValidators: true }
    );

    if (!updatedRally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    return NextResponse.json(updatedRally);
  } catch (error) {
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

    // Cascade: remove all stages and answer sheets belonging to this rally.
    await Promise.all([
      Stage.deleteMany({ rallyId: id }),
      AnswerSheet.deleteMany({ rallyId: id }),
    ]);

    return NextResponse.json({ message: 'Rally deleted successfully' });
  } catch (error) {
    console.error('Failed to delete rally:', error);
    return NextResponse.json({ error: 'Failed to delete rally' }, { status: 500 });
  }
}
