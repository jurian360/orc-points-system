import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Stage, Rally } from '../../models';
import { readBody, requireSession } from '../../lib/api-guard';
import { parseName, processScoreKey } from '../../lib/validation';
import { rescoreRally } from '../../lib/rescore';
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

    // Creation order is the running order of the rally, and the order the time
    // delta is chained in (app/lib/rescore.ts sorts identically) — `_id` breaks
    // the tie when two stages were created in the same millisecond.
    const stages = await Stage.find({ rallyId }).sort({ createdAt: 1, _id: 1 });
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

    const { scoreKey, timeScoreKey, merkScoreKey, timeConfig } = processScoreKey(body);

    const stage = new Stage({ rallyId, name, scoreKey, timeScoreKey, merkScoreKey, timeConfig });
    const savedStage = await stage.save();

    // The new stage is now the last one, so the finish of the stage that used to
    // be last stops being a disqualification and becomes a penalty. Every
    // participant's time chain has to be rebuilt.
    await rescoreRally(rallyId);

    return NextResponse.json(savedStage, { status: 201 });
  } catch (error) {
    console.error('Failed to create stage:', error);
    return NextResponse.json({ error: 'Failed to create stage' }, { status: 500 });
  }
}
