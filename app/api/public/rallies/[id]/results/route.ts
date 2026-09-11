import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '../../../../../lib/mongodb';
import { Rally } from '../../../../../models';
import { clientIp, rateLimit } from '../../../../../lib/rate-limit';
import { computeRallyStandings } from '../../../../../lib/standingsQuery';

// GET /api/public/rallies/[id]/results — the public results page's data.
//
// **This route is public**, like the two Android-app endpoints
// (app/api/app/*): no session, reachable by anyone with the link. It pays for
// that the same way they do — a per-IP rate limit — but its gate is
// different: a participant scanning a QR has no identity at all to check, so
// that code is the credential. Here the rally itself decides whether it may
// be read at all: `publicResultsEnabled` is an admin's own switch, flipped
// from the rally dashboard, and a rally that does not exist or has not been
// turned on answers the same 404 either way, so this route cannot be used to
// find out which private rallies exist. That check runs — cheaply — before
// the standings are computed, so a disabled rally costs this route nothing
// more than the one flag it was refused on.
//
// The standings themselves come from app/lib/standingsQuery.ts, the same
// computation the authenticated dashboard route uses — a public reader and an
// official must never see two different rankings of the same field.
//
// The four numbers per stage (ORC's, Tijd, Diversen, the stage's own total)
// are public too, the same as they are on the printed result sheet — only an
// answer sheet's own rows (the letters, the WPT's, the merk column) are not,
// so `stagePenalties` comes back per entry but nothing that would point at
// one sheet does.
const RESULTS_RATE_LIMIT = 60;
const RESULTS_WINDOW_MS = 60 * 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ok, retryAfter } = rateLimit(
    `public-results:${clientIp(request)}`,
    RESULTS_RATE_LIMIT,
    RESULTS_WINDOW_MS
  );

  if (!ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const { id } = await params;
  const notFound = NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!mongoose.Types.ObjectId.isValid(id)) return notFound;

  try {
    await dbConnect();

    const rally = await Rally.findById(id, 'publicResultsEnabled');
    if (!rally || !rally.publicResultsEnabled) return notFound;

    const result = await computeRallyStandings(id);
    if (!result) return notFound;

    return NextResponse.json({
      rally: result.rally,
      totalStages: result.totalStages,
      // In running order, headed with a name — enough to label the per-stage
      // columns. Not `routeId`: this page does not group by leg the way the
      // print sheet can, so there is nothing here that would use it.
      stages: result.stages.map((stage) => ({ _id: stage._id, name: stage.name })),
      standings: result.standings.map((entry) => ({
        eq: entry.eq,
        classification: entry.classification,
        driverName: entry.driverName,
        navigatorName: entry.navigatorName,
        totalPenalty: entry.totalPenalty,
        orcPenalty: entry.orcPenalty,
        timePenalty: entry.timePenalty,
        merkPenalty: entry.merkPenalty,
        status: entry.status,
        rank: entry.rank,
        // Keyed by stage id, same shape `stages` above comes in: what a stage
        // cost this crew, or what a blank card costs on it when they have no
        // sheet for it (`missingSheet`) — never the sheet's own rows.
        stagePenalties: Object.fromEntries(
          Object.entries(entry.stagePenalties).map(([stageId, score]) => [
            stageId,
            {
              totalPenalty: score.totalPenalty,
              orcPenalty: score.orcPenalty,
              timePenalty: score.timePenalty,
              merkPenalty: score.merkPenalty,
              missingSheet: score.missingSheet,
            },
          ])
        ),
      })),
    });
  } catch (error) {
    console.error('Failed to load public results:', error);
    return NextResponse.json({ error: 'Could not load these results' }, { status: 500 });
  }
}
