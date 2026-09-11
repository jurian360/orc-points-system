import 'server-only';

import { NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Person } from '../../models';
import { requireParticipant } from '../../lib/api-guard';
import { toPersonDetail } from '../../lib/riderResults';

// GET /api/me — the signed-in rider's own record.
//
// The `/api/me` routes are the participants' whole half of this API. They are
// authorised by *being* the rider whose data is returned: the id comes out of
// the session and from nowhere else, so there is no id in a path or a body for
// anybody to change into somebody else's.
export async function GET() {
  const session = await requireParticipant();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const person = await Person.findById(session.user.sub).lean();
    // The guard re-read this account a moment ago, so this is only reachable
    // by a rider deleted mid-request. Their session is gone either way.
    if (!person) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return NextResponse.json(
      toPersonDetail(person as unknown as Parameters<typeof toPersonDetail>[0])
    );
  } catch (error) {
    console.error('Failed to load your record:', error);
    return NextResponse.json({ error: 'Failed to load your record' }, { status: 500 });
  }
}
