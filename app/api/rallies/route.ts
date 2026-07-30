import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Rally } from '../../models';

export async function GET() {
  try {
    await dbConnect();
    const rallies = await Rally.find({}).sort({ createdAt: -1 });
    return NextResponse.json(rallies);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch rallies' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Rally name is required' }, { status: 400 });
    }

    await dbConnect();

    const rally = new Rally({ name: body.name.trim() });
    const savedRally = await rally.save();

    return NextResponse.json(savedRally, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create rally' }, { status: 500 });
  }
}
