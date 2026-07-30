import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Rally, Stage, AnswerSheet } from '../../../models';
import mongoose from 'mongoose';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    return NextResponse.json({ error: 'Failed to fetch rally' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await dbConnect();

    const { id } = await params;
    const body = await request.json();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Rally name is required' }, { status: 400 });
    }

    const updatedRally = await Rally.findByIdAndUpdate(
      id,
      { name: body.name.trim() },
      { new: true, runValidators: true }
    );

    if (!updatedRally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    return NextResponse.json(updatedRally);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update rally' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    return NextResponse.json({ error: 'Failed to delete rally' }, { status: 500 });
  }
}
