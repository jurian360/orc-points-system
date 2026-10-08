import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import dbConnect from '../../../../lib/mongodb';
import { requireRallyAdmin } from '../../../../lib/api-guard';
import { parseObjectId } from '../../../../lib/validation';
import { buildRallyExport } from '../../../../lib/rallyTransfer';

// GET /api/rallies/[id]/export
//
// The rally as a file to import on another installation of this app — the
// server and a laptop running offline (app/lib/rallyTransfer.ts). Admin-only:
// it carries the whole entry list and every answer key, and moving a rally is
// an admin's job like duplicating one.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const id = parseObjectId((await params).id);
  if (!id) {
    return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
  }

  try {
    await dbConnect();

    const data = await buildRallyExport(id);
    if (!data) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    // The code is letters, digits and dashes only (parseRallyCode), so it is
    // safe in the header as it is.
    const stamp = data.exportedAt.slice(0, 16).replace(/[:T]/g, '-');
    return new NextResponse(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${data.rally.code}-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to export rally:', error);
    return NextResponse.json({ error: 'Failed to export rally' }, { status: 500 });
  }
}
