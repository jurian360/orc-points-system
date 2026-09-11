import 'server-only';

import { NextResponse } from 'next/server';
import { requireParticipant } from '../../../lib/api-guard';
import { loadRiderResults } from '../../../lib/riderResults';

// GET /api/me/results — the signed-in rider's own history: which rallies they
// rode, with whom, and how they did.
//
// The id is `session.user.sub` and nothing else. That is the whole of the
// authorisation here, and it is why this route exists separately from
// `/api/persons/[id]/results` rather than being the same route with a looser
// guard: a route that takes an id has to be *told* not to accept somebody
// else's, and this one cannot be.
export async function GET() {
  const session = await requireParticipant();
  if (!session.ok) return session.response;

  try {
    const results = await loadRiderResults(session.user.sub);
    if (!results) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return NextResponse.json(results);
  } catch (error) {
    console.error('Failed to load your results:', error);
    return NextResponse.json({ error: 'Failed to load your results' }, { status: 500 });
  }
}
