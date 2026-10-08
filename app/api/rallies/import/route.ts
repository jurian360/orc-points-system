import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import dbConnect from '../../../lib/mongodb';
import { readBody, requireRallyAdmin } from '../../../lib/api-guard';
import { RALLY_IMPORT_MAX_BODY_BYTES } from '../../../lib/body';
import { applyRallyImport, parseRallyImport } from '../../../lib/rallyTransfer';

// POST /api/rallies/import
//
// A rally export file (GET /api/rallies/[id]/export), read in the browser and
// sent as JSON. The rally with the file's code is updated, or created when
// there is none; nothing is deleted, and the rally is re-scored at the end
// (app/lib/rallyTransfer.ts).
//
// The one route with a body cap above 256 KB: a file holds every stage key and
// every answer sheet of a rally. It stays admin-only and object-only JSON, and
// the cap is still counted on the stream.
export async function POST(request: NextRequest) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request, RALLY_IMPORT_MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  // All or nothing: the whole file is validated before the first write.
  const data = parseRallyImport(parsed.body);
  if (!data.ok) {
    return NextResponse.json({ error: data.error }, { status: 400 });
  }

  try {
    await dbConnect();
    const result = await applyRallyImport(data.value);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    // The rally code is unique; a rally created with it at this very moment
    // is the one way to get here.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'Another rally already uses that code or route name' },
        { status: 409 }
      );
    }
    console.error('Failed to import rally:', error);
    return NextResponse.json({ error: 'Failed to import rally' }, { status: 500 });
  }
}
