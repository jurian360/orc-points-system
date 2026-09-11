import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '../../../../lib/api-guard';
import { computeRallyStandings } from '../../../../lib/rallyStandings';
import { parseObjectId } from '../../../../lib/validation';

// Returns the rally standings: one entry per participant (eq), with the total
// penalty summed across all of that participant's answer sheets in the rally.
// Ranked ascending — the lowest total penalty is the winner.
//
// The computation itself lives in `app/lib/rallyStandings.ts`, because the
// overall standings of a season read exactly these numbers for ten rallies at
// a time (app/lib/overallStandings.ts). This route is the HTTP shape around it
// and nothing more.
//
// Each entry splits its total into the ORC's (letters), the Tijd (time) and the
// Diversen (merk) part, so the standings show where a crew lost their points —
// and carries the same three parts per stage (`stagePenalties`), against the
// `stages` running order this route also returns, so a result sheet can show
// what each stage of the rally cost a crew.
//
// The rally's `routes` come back with them, in the order they are ridden, and
// each stage names the one it is in — so the results can group their per-stage
// columns by leg and rank each leg on its own. A rally with no routes returns an
// empty list, which is exactly what it means: one leg, holding every stage.
//
// A stage a crew has **no sheet for** is scored as a blank card
// (app/lib/missingSheets.ts): the letters of the key all missing, every control
// of the stage missed, the merk column untyped. A crew is not scored on a stage
// they handed no card in for, so leaving it out would put them ahead of the
// whole field on a fraction of the points. Those stages are marked
// `missingSheet` so the screen and the paper can say where the points came
// from.
//
// Every entry carries a `status`, which is what a result sheet prints instead of
// a place when a crew has no place:
//
//   * `finished` — the crew rode the rally and came in: they are ranked 1, 2, 3.
//   * `dnf` — they started but did not finish, either because the last stage's
//     card puts them outside the finish window (or has no finish time at all,
//     see app/lib/timeScoring.ts) or because they have **no card for the last
//     stage** at all. Their points are kept and printed as they stand; they are
//     ranked behind everyone who finished.
//   * `dns` — they did not start: a crew on the entry list with no sheet in the
//     whole rally, so every stage of theirs is a blank card. They are listed
//     behind the DNF's, because a crew who rode and retired is ahead of one who
//     never came to the start.
//
// A crew is on this list when the entry list holds them or when a sheet names
// them, so a DNS is in the results as a DNS rather than missing from them.
//
// Each entry also carries the crew's class, their names and the ids of the two
// riders behind them when the entry list has them, so the table can show who an
// EQ is and the season can group the same pair across ten rallies.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;

    const rallyId = parseObjectId(id);
    if (!rallyId) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const standings = await computeRallyStandings(rallyId);
    if (!standings) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    return NextResponse.json(standings);
  } catch (error) {
    console.error('Failed to compute standings:', error);
    return NextResponse.json({ error: 'Failed to compute standings' }, { status: 500 });
  }
}
