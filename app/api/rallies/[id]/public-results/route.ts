import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '../../../../lib/mongodb';
import { Rally } from '../../../../models';
import { readBody, requireRallyAdmin } from '../../../../lib/api-guard';

// PUT /api/rallies/[id]/public-results — turn this rally's public results
// page on or off. Its own route rather than a field on PUT /api/rallies/[id]:
// that route requires a `name` on every call (a rename), and a toggle should
// not have to resend it.
//
// An admin's own switch, not a secret being minted: once on, the rally's id
// in the URL (/public/rallies/[id]) is the whole address, the same one a
// printed QR code carries — see app/api/public/rallies/[id]/results/route.ts
// and "Public results page" in CLAUDE.md.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  if (typeof parsed.body.enabled !== 'boolean') {
    return NextResponse.json({ error: '"enabled" must be a boolean' }, { status: 400 });
  }

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const rally = await Rally.findByIdAndUpdate(
      id,
      { publicResultsEnabled: parsed.body.enabled },
      { new: true, runValidators: true }
    );

    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    return NextResponse.json({ publicResultsEnabled: rally.publicResultsEnabled });
  } catch (error) {
    console.error('Failed to change public results setting:', error);
    return NextResponse.json(
      { error: 'Failed to change the public results setting' },
      { status: 500 }
    );
  }
}
