import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Season } from '../../../models';
import { readBody, requireRallyAdmin, requireSession } from '../../../lib/api-guard';
import { loadSeasonSettings } from '../../../lib/seasonStandings';
import { parseSeasonSettings, parseYearParam } from '../../../lib/validation';

// The settings of one rally year: how many of a crew's results count, and how
// many rallies a pair has to have ridden together to be placed at all.
//
// There is no "create a season" step — a rally with a date in it is the season
// starting — so a year nobody has configured is not a 404: it answers with the
// defaults in `app/lib/seasons.ts`, and a PUT is what first writes a document.
//
// Writing is `requireRallyAdmin()`: these two numbers decide who is champion,
// which is the same weight as an answer key.

function invalidYear() {
  return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const { year: yearParam } = await params;
    const year = parseYearParam(yearParam);
    if (year === null) return invalidYear();

    return NextResponse.json(await loadSeasonSettings(year));
  } catch (error) {
    console.error('Failed to load the season settings:', error);
    return NextResponse.json({ error: 'Failed to load the season' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const { year: yearParam } = await params;
    const year = parseYearParam(yearParam);
    if (year === null) return invalidYear();

    const settings = parseSeasonSettings(year, parsed.body);
    if (!settings) {
      return NextResponse.json(
        {
          error:
            'Counting results must be a whole number (0 counts every rally) and a crew must ' +
            'need at least one rally.',
        },
        { status: 400 }
      );
    }

    await dbConnect();

    // Upserts: the first time a year is configured is also the first time it
    // has a document.
    await Season.findOneAndUpdate(
      { year },
      {
        $set: {
          countingResults: settings.countingResults,
          minimumRallies: settings.minimumRallies,
          updatedAt: new Date(),
        },
      },
      { upsert: true, runValidators: true }
    );

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Failed to save the season settings:', error);
    return NextResponse.json({ error: 'Failed to save the season' }, { status: 500 });
  }
}
