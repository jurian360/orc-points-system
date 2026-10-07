import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../lib/mongodb';
import { requireSession } from '../../../../lib/api-guard';
import { loadRunningOrder } from '../../../../lib/rallyOrder';
import { AnswerSheet, Participant, Rally } from '../../../../models';

// GET /api/rallies/[id]/offline — the whole rally in one read, for the offline
// workspace (app/offline, see "Offline mode" in CLAUDE.md).
//
// An official downloads this while the device still has a connection and works
// on it in the browser once it has none: the stages with their keys in running
// order, the routes, the entry list and every sheet with its `revision`, which
// is what the upload is later checked against. One request rather than the five
// the pages make, so the copy is one consistent moment of the rally instead of
// five that a write could fall between.
//
// A read, so `requireSession()`: everything in it is what a data-entry official
// already reads to type a card. The account's role comes with it so the
// workspace shows the time import to an admin only, as the online app does —
// a convenience, not a control: what the workspace uploads is answer sheets,
// which the sync route guards on its own.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const rally: any = await Rally.findById(id).select('name code').lean();
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    const [{ stages, routes }, participants, sheets] = await Promise.all([
      loadRunningOrder(id),
      Participant.find({ rallyId: id }).sort({ eq: 1 }).lean(),
      AnswerSheet.find({ rallyId: id }).lean(),
    ]);

    return NextResponse.json({
      rally: { _id: String(rally._id), name: rally.name, code: rally.code || '' },
      routes: routes.map((route: any) => ({
        _id: String(route._id),
        rallyId: String(route.rallyId),
        name: route.name,
        order: route.order,
      })),
      // In running order already (app/lib/rallyOrder.ts), which is what the
      // scoring in the browser needs them in.
      stages,
      participants,
      sheets,
      user: { username: session.user.username, role: session.user.role },
      downloadedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to load the rally for offline use:', error);
    return NextResponse.json({ error: 'Failed to load the rally' }, { status: 500 });
  }
}
