import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '../../../lib/api-guard';
import { loadSeasonStandings, loadSeasonYears } from '../../../lib/seasonStandings';
import { parseYearParam } from '../../../lib/validation';

// GET /api/standings/overall?year=2026 — the overall standings of one season.
//
// Who won the year: the crews — pairs of riders, not EQ numbers — ranked on
// what the year's **official** rallies cost them, with the pairs who rode
// fewer than the season's minimum together listed behind the field rather than
// dropped.
//
// It scores nothing and it re-adds nothing. Every rally total here comes from
// `computeRallyStandings`, the same function behind the rally's own standings
// table and its printed result sheet, and the grouping rule is
// `app/lib/overallStandings.ts`, which the browser shares.
//
// `requireSession()`: reading the standings is any official's, the same guard
// the per-rally standings carry. A rider reads their own season through
// `/api/me/results`.
export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const years = await loadSeasonYears();

    // No year asked for: the most recent one that has a rally in it. A club
    // with no rallies at all falls back to this calendar year, so the page
    // renders an empty season rather than an error.
    const requested = parseYearParam(request.nextUrl.searchParams.get('year'));
    if (request.nextUrl.searchParams.has('year') && requested === null) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    const year = requested ?? years[0] ?? new Date().getFullYear();

    const season = await loadSeasonStandings(year);

    return NextResponse.json({
      year,
      // Offered so a year picker needs no second request. A year that has
      // rallies but is not in this list cannot exist — the list *is* the
      // rallies' years.
      years: years.includes(year) ? years : [year, ...years],
      settings: season.settings,
      rallies: season.rallies,
      unofficialRallies: season.unofficialRallies,
      entries: season.entries,
    });
  } catch (error) {
    console.error('Failed to compute the overall standings:', error);
    return NextResponse.json(
      { error: 'Failed to compute the overall standings' },
      { status: 500 }
    );
  }
}
