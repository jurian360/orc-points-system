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
// What is left out on purpose: `stagePenalties` (no per-stage breakdown on
// this page, only the rally total — see "Public results page" in CLAUDE.md)
// and anything that would point at one sheet (an answer sheet is never public,
// only the totals it adds up into).
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
      })),
    });
  } catch (error) {
    console.error('Failed to load public results:', error);
    return NextResponse.json({ error: 'Could not load these results' }, { status: 500 });
  }
}
