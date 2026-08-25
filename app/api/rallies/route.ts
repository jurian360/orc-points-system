import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Rally } from '../../models';
import { readBody, requireSession, requireRallyAdmin } from '../../lib/api-guard';
import { parseName } from '../../lib/validation';
import { parseRallyCode, slugFromName } from '../../lib/rallyCodes';

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    await dbConnect();
    const rallies = await Rally.find({}).sort({ createdAt: -1 });
    return NextResponse.json(rallies);
  } catch (error) {
    console.error('Failed to fetch rallies:', error);
    return NextResponse.json({ error: 'Failed to fetch rallies' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const name = parseName(parsed.body.name);
  if (!name) {
    return NextResponse.json(
      { error: 'Rally name is required (1-200 characters)' },
      { status: 400 }
    );
  }

  // Officials name the code themselves. A rally created without one — by an
  // older client, or by somebody who left the field empty — falls back to the
  // suggestion the form would have made, so every rally has a code from the
  // start and the QR pages never have to mint one.
  const code =
    parsed.body.code === undefined || parsed.body.code === ''
      ? slugFromName(name)
      : parseRallyCode(parsed.body.code);

  if (!code) {
    return NextResponse.json(
      { error: 'Rally code must be letters, digits and dashes (up to 32 characters)' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const rally = new Rally({ name, code });
    const savedRally = await rally.save();

    return NextResponse.json(savedRally, { status: 201 });
  } catch (error) {
    // The unique index on `code` is what keeps two rallies from answering to
    // the same submission from the app.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'Another rally already uses that code' },
        { status: 409 }
      );
    }

    console.error('Failed to create rally:', error);
    return NextResponse.json({ error: 'Failed to create rally' }, { status: 500 });
  }
}
