import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../lib/mongodb';
import { Rally, Stage } from '../../../../models';
import { readBody, requireSession } from '../../../../lib/api-guard';
import {
  parseLatitude,
  parseLongitude,
  parseScanRadius,
  parseScanReference,
} from '../../../../lib/validation';
import { signKey } from '../../../../lib/scanLocations';
import {
  buildStageScanReport,
  loadCrews,
  stageScanRadius,
} from '../../../../lib/scanReports';

// Where the crews of one stage were when they scanned its route QR codes.
//
// The check itself is app/lib/scanLocations.ts; this route feeds it the stage's
// sheets and lets officials do the two things only they can decide:
//
//   pin     say where a sign really stands — by accepting the consensus of the
//           scans, or by typing coordinates read off a map. A pin outranks the
//           consensus, which is what makes the check usable on a sign only one
//           or two crews scanned.
//   radius  how far from a sign a scan may be before it is flagged.
//
// Nothing here touches a penalty: a flag is something for an official to look
// into, never a score.

async function loadStage(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { error: NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 }) };
  }

  await dbConnect();

  const stage = await Stage.findById(id);
  if (!stage) {
    return { error: NextResponse.json({ error: 'Stage not found' }, { status: 404 }) };
  }

  const rally = await Rally.findById(stage.rallyId);
  if (!rally) {
    return { error: NextResponse.json({ error: 'Rally not found' }, { status: 404 }) };
  }

  return { stage, rally };
}

async function buildResponse(rally: any, stage: any) {
  const [report, crews] = await Promise.all([
    buildStageScanReport(stage),
    loadCrews(rally._id),
  ]);

  return {
    rally: { _id: String(rally._id), name: rally.name },
    stage: { _id: String(stage._id), name: stage.name },
    radiusMeters: stageScanRadius(stage),
    report,
    crews,
  };
}

// GET /api/stages/[id]/scan-locations — the report as it stands.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const loaded = await loadStage(id);
    if ('error' in loaded) return loaded.error;

    return NextResponse.json(await buildResponse(loaded.rally, loaded.stage));
  } catch (error) {
    console.error('Failed to build the scan-location report of a stage:', error);
    return NextResponse.json({ error: 'Failed to load the scan locations' }, { status: 500 });
  }
}

// POST /api/stages/[id]/scan-locations — pin a sign, drop a pin, or change the
// radius. Every action answers with the rebuilt report, so the page never has
// to guess what the server did.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;
  const action = body.action;

  if (action !== 'pin' && action !== 'unpin' && action !== 'radius') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  let radius: number | null = null;
  let sign: { rowNumber: number; letter: string } | null = null;
  let latitude: number | null = null;
  let longitude: number | null = null;

  if (action === 'radius') {
    radius = parseScanRadius(body.radiusMeters);
    if (radius === null) {
      return NextResponse.json(
        { error: 'The radius must be between 10 and 10000 metres' },
        { status: 400 }
      );
    }
  } else {
    sign = parseScanReference(body);
    if (!sign) {
      return NextResponse.json({ error: 'Invalid row or letter' }, { status: 400 });
    }

    if (action === 'pin') {
      latitude = parseLatitude(body.latitude);
      longitude = parseLongitude(body.longitude);
      if (latitude === null || longitude === null) {
        return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
      }
    }
  }

  try {
    const { id } = await params;
    const loaded = await loadStage(id);
    if ('error' in loaded) return loaded.error;

    const { rally, stage } = loaded;

    if (action === 'radius') {
      stage.locationConfig = { ...(stage.locationConfig || {}), radiusMeters: radius };
    } else {
      const key = signKey(sign!.rowNumber, sign!.letter);
      const kept = (stage.scanReferences || []).filter(
        (reference: any) => signKey(Number(reference.rowNumber), String(reference.letter)) !== key
      );

      stage.scanReferences =
        action === 'pin'
          ? [...kept, { rowNumber: sign!.rowNumber, letter: sign!.letter, latitude, longitude }]
          : kept;
    }

    await stage.save();

    return NextResponse.json(await buildResponse(rally, stage));
  } catch (error) {
    console.error('Failed to update the scan-location settings of a stage:', error);
    return NextResponse.json({ error: 'Failed to save the scan locations' }, { status: 500 });
  }
}
