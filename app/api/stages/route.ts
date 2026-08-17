import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Stage, Rally } from '../../models';
import { readBody, requireSession } from '../../lib/api-guard';
import { parseName, processScoreKey } from '../../lib/validation';
import mongoose from 'mongoose';

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const rallyId = searchParams.get('rallyId');

  if (!rallyId || !mongoose.Types.ObjectId.isValid(rallyId)) {
    return NextResponse.json({ error: 'Valid rallyId is required' }, { status: 400 });
  }

  try {
    await dbConnect();

    const stages = await Stage.find({ rallyId }).sort({ createdAt: 1 });
    return NextResponse.json(stages);
  } catch (error) {
    console.error('Failed to fetch stages:', error);
    return NextResponse.json({ error: 'Failed to fetch stages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  const rallyId = body.rallyId;
  if (typeof rallyId !== 'string' || !mongoose.Types.ObjectId.isValid(rallyId)) {
    return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
  }

  const name = parseName(body.name);
  if (!name) {
    return NextResponse.json(
      { error: 'Stage name is required (1-200 characters)' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const rally = await Rally.findById(rallyId);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const { scoreKey, timeScoreKey, merkScoreKey } = processScoreKey(body);

    const stage = new Stage({ rallyId, name, scoreKey, timeScoreKey, merkScoreKey });
    const savedStage = await stage.save();

    return NextResponse.json(savedStage, { status: 201 });
  } catch (error) {
    console.error('Failed to create stage:', error);
    return NextResponse.json({ error: 'Failed to create stage' }, { status: 500 });
  }
}
