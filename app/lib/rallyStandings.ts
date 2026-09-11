import 'server-only';

// The standings of one rally, computed out of the database.
//
// This used to be the body of `GET /api/rallies/[id]/standings` and is now a
// module because a **second** reader arrived: the overall standings of a
// season add up what each rally gave a crew, over ten rallies at a time
// (app/lib/overallStandings.ts). The alternative was a second aggregation that
// reads the same sheets and would eventually answer something slightly
// different from the table on the screen — which is the one thing the scoring
// side of this app is organised to prevent.
//
// It **scores nothing**. Every penalty here was written by `app/lib/rescore.ts`
// at the time the sheet was saved, except the blank cards of the stages a crew
// handed nothing in for, which come from `app/lib/missingSheets.ts` — itself a
// call into the same three scoring functions a real sheet is scored by.

import dbConnect from './mongodb';
import { AnswerSheet, Participant, Rally } from '../models';
import { blankSheetPenalties } from './missingSheets';
import { loadRunningOrder } from './rallyOrder';
import { resolveStatus, STATUS_ORDER, type StandingsStatus } from './standings';
import type { ClassificationValue } from './participants';
import type { Vehicle } from './persons';
import type {
  StandingsEntry,
  StandingsRoute,
  StandingsStage,
  StandingsStageScore,
} from '../types';

export interface RallyStandings {
  totalStages: number;
  routes: StandingsRoute[];
  stages: StandingsStage[];
  standings: StandingsEntry[];
}

// `null` means there is no rally with this id. Every caller answers 404 to
// that, so it is a value rather than a thrown error.
export async function computeRallyStandings(rallyId: string): Promise<RallyStandings | null> {
  await dbConnect();

  const rally = await Rally.findById(rallyId);
  if (!rally) return null;

  // The stages in running order — the routes in their order, and inside a
  // route the creation order of its stages, the same order the re-scoring uses
  // — so the per-stage parts below come back in the order the rally is ridden
  // and a result sheet can head a column with its stage and group it under its
  // route. The keys come with them: a crew with no sheet for a stage is scored
  // on that stage as a blank card, which is scored against its keys.
  const { stages, routes, positionByStage } = await loadRunningOrder(
    rallyId,
    'name scoreKey timeScoreKey merkScoreKey timeConfig'
  );

  const totalStages = stages.length;
  const sheets = await AnswerSheet.find({ rallyId });
  const participants = await Participant.find({ rallyId });

  interface CrewDetails {
    classification?: ClassificationValue;
    driverName?: string;
    navigatorName?: string;
    driverId?: unknown;
    navigatorId?: unknown;
    driverClassification?: ClassificationValue;
    navigatorClassification?: ClassificationValue;
    vehicle?: Vehicle;
  }

  const detailsByEq = new Map<number, CrewDetails>(
    participants.map((participant: { eq: number }) => [participant.eq, participant as CrewDetails])
  );

  // Aggregate penalties per participant. `totalPenalty` on a sheet already
  // covers the ORC's, the time and the merk part; all three are carried
  // separately so the table can show where the points came from. The ORC's
  // part is what is left of the stored total after the stored time and merk
  // parts — they are written together by app/lib/rescore.ts, so no sheet has
  // to be re-scored here.
  type Aggregate = {
    eq: number;
    totalPenalty: number;
    orcPenalty: number;
    timePenalty: number;
    merkPenalty: number;
    stagePenalties: Record<string, StandingsStageScore>;
    sheetsSubmitted: number;
    missingSheets: number;
    disqualified: boolean;
    status: StandingsStatus;
  };

  const byParticipant = new Map<number, Aggregate>();

  // A crew of this rally, created the first time a sheet or the entry list
  // names them. `status` is decided once every sheet has been counted.
  const entryFor = (eq: number): Aggregate => {
    const existing = byParticipant.get(eq);
    if (existing) return existing;

    const created: Aggregate = {
      eq,
      totalPenalty: 0,
      orcPenalty: 0,
      timePenalty: 0,
      merkPenalty: 0,
      stagePenalties: {},
      sheetsSubmitted: 0,
      missingSheets: 0,
      disqualified: false,
      status: 'finished',
    };
    byParticipant.set(eq, created);
    return created;
  };

  for (const sheet of sheets) {
    const existing = entryFor(sheet.eq);
    const totalPenalty = sheet.totalPenalty || 0;
    const timePenalty = sheet.timePenalty || 0;
    const merkPenalty = sheet.merkPenalty || 0;
    const orcPenalty = totalPenalty - timePenalty - merkPenalty;
    existing.totalPenalty += totalPenalty;
    existing.orcPenalty += orcPenalty;
    existing.timePenalty += timePenalty;
    existing.merkPenalty += merkPenalty;
    // One sheet per participant per stage (the unique index says so), so this
    // never overwrites a stage a crew already has a score for.
    existing.stagePenalties[String(sheet.stageId)] = {
      totalPenalty,
      orcPenalty,
      timePenalty,
      merkPenalty,
      disqualified: Boolean(sheet.disqualified),
      missingSheet: false,
    };
    existing.sheetsSubmitted += 1;
    existing.disqualified = existing.disqualified || Boolean(sheet.disqualified);
  }

  // The entry list is the other half of the field: a crew nobody has typed a
  // card for is a DNS, and a DNS belongs on the result sheet as a DNS rather
  // than nowhere. A crew with sheets but no entry-list record — an EQ that
  // predates the list — is already here from the loop above.
  //
  // A rally with no stages yet is the exception: there is nothing to ride, so
  // nobody has failed to start it. Its standings stay empty while it is being
  // set up instead of filling with the whole entry list as DNS.
  if (stages.length > 0) {
    for (const participant of participants) {
      entryFor(participant.eq);
    }
  }

  // A stage a crew has no sheet for is scored as a blank card. A blank card
  // costs every crew the same, so it is scored once per stage and then added
  // to each crew that is short of that stage's card. Where the stage sits in
  // the legs is what the finish row reads: the break after a stage is lost
  // with its finish unless nothing follows it in its own route, and only the
  // rally's own finish is a disqualification.
  const blankByStage = new Map(
    stages.map((stage) => [
      String(stage._id),
      blankSheetPenalties(stage, {
        endsRoute: Boolean(positionByStage.get(String(stage._id))?.endsRoute),
        endsRally: Boolean(positionByStage.get(String(stage._id))?.endsRally),
      }),
    ])
  );

  for (const entry of byParticipant.values()) {
    for (const [stageId, blank] of blankByStage) {
      if (entry.stagePenalties[stageId]) continue;

      entry.stagePenalties[stageId] = {
        totalPenalty: blank.totalPenalty,
        orcPenalty: blank.orcPenalty,
        timePenalty: blank.timePenalty,
        merkPenalty: blank.merkPenalty,
        // Whether the crew is out of the rally is decided below, on whether
        // they have a card for the *last* stage.
        disqualified: false,
        missingSheet: true,
      };
      entry.totalPenalty += blank.totalPenalty;
      entry.orcPenalty += blank.orcPenalty;
      entry.timePenalty += blank.timePenalty;
      entry.merkPenalty += blank.merkPenalty;
      entry.missingSheets += 1;
    }
  }

  // Did they start, and did they finish? A crew with no card at all never
  // started; a crew whose last stage has no card, or whose last card puts them
  // outside the finish window, started but did not finish.
  //
  // "The last stage" is the last one in the running order, which on a rally
  // with routes is the last stage of the last route — the one finish that
  // disqualifies. The rule does not change; the order it is read off does.
  const lastStageId = stages.length > 0 ? String(stages[stages.length - 1]._id) : '';

  for (const entry of byParticipant.values()) {
    entry.status = resolveStatus({
      sheetsSubmitted: entry.sheetsSubmitted,
      disqualified: entry.disqualified,
      missingLastStageSheet: Boolean(
        lastStageId && entry.stagePenalties[lastStageId]?.missingSheet
      ),
    });
  }

  // The crews who finished are ranked on their points; the DNF's follow them
  // and the DNS's follow those, because a crew who rode and retired is ahead
  // of one who never came to the start. Within a group it is the points, then
  // the EQ.
  const standings: StandingsEntry[] = Array.from(byParticipant.values())
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.totalPenalty - b.totalPenalty ||
        a.eq - b.eq
    )
    .map((entry, index) => {
      const details = detailsByEq.get(entry.eq);
      return {
        ...entry,
        classification: details?.classification || '',
        driverName: details?.driverName || '',
        navigatorName: details?.navigatorName || '',
        // The two riders behind this entry. Null on an EQ that was typed
        // straight onto a card without a crew being registered — the overall
        // standings then have no pair to group it under, which is exactly
        // right: an entry nobody registered is not a crew's season.
        driverId: details?.driverId ? String(details.driverId) : null,
        navigatorId: details?.navigatorId ? String(details.navigatorId) : null,
        rank: index + 1,
      };
    });

  return {
    totalStages,
    // The rally's legs, in the order they are ridden. **Empty on a rally with
    // no routes**, which is how a reader tells the two kinds of rally apart —
    // the same way it uses `totalStages > 1` to decide whether per-stage
    // columns are worth printing. Per-route totals are not returned: they are
    // these stages' numbers added up, and a second copy of a number is a
    // second place for it to disagree (app/lib/routes.ts `routeTotals`).
    routes: routes.map((route) => ({
      _id: String(route._id),
      name: route.name,
    })),
    stages: stages.map((stage) => ({
      _id: String(stage._id),
      name: stage.name,
      routeId: stage.routeId ? String(stage.routeId) : null,
    })),
    standings,
  };
}
