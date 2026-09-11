import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/api-guard';
import { loadRiderResults } from '../../../../lib/riderResults';
import { parseObjectId } from '../../../../lib/validation';

// GET /api/persons/[id]/results — one rider's history, for an official.
//
// The rallies they entered, who they rode each of them with, what the crew
// scored, and their crews per season with the counting rule applied. It is the
// same module the rider's own dashboard reads (`/api/me/results`), so an
// official and the rider cannot be looking at different histories.
//
// `requireSession()`: reading results is any official's, and it is most of
// what a classification admin does — they set a rider's class by looking at
// what that rider has been doing.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;

    const personId = parseObjectId(id);
    if (!personId) {
      return NextResponse.json({ error: 'Invalid rider id' }, { status: 400 });
    }

    const results = await loadRiderResults(personId);
    if (!results) {
      return NextResponse.json({ error: 'Rider not found' }, { status: 404 });
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Failed to load the rider's results:", error);
    return NextResponse.json({ error: 'Failed to load the results' }, { status: 500 });
  }
}
