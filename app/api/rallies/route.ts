import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Rally } from '../../models';
import { readBody, requireSession } from '../../lib/api-guard';
import { parseName } from '../../lib/validation';

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

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
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const name = parseName(parsed.body.name);
  if (!name) {
    return NextResponse.json(
      { error: 'Rally name is required (1-200 characters)' },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const rally = new Rally({ name });
    const savedRally = await rally.save();

    return NextResponse.json(savedRally, { status: 201 });
  } catch (error) {
    console.error('Failed to create rally:', error);
    return NextResponse.json({ error: 'Failed to create rally' }, { status: 500 });
  }
}
