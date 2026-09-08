import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../../lib/mongodb';
import { Rally, Stage, AnswerSheet, Participant } from '../../../../models';
import { requireSession } from '../../../../lib/api-guard';
import { stageMaxPenalties } from '../../../../lib/stageMaximums';
import {
  resolveStatus,
  STATUS_ORDER,
  type StandingsStatus,
} from '../../../../lib/standings';
import mongoose from 'mongoose';

// Returns the rally standings: one entry per participant (eq), with the total
// penalty summed across all of that participant's answer sheets in the rally.
// Ranked ascending — the lowest total penalty is the winner.
//
// Each entry splits its total into the ORC's (letters), the Tijd (time) and the
// Diversen (merk) part, so the standings show where a crew lost their points —
// and carries the same three parts per stage (`stagePenalties`), against the
// `stages` running order this route also returns, so a result sheet can show
// what each leg of the rally cost a crew.
//
// A stage a crew has **no sheet for** is charged the maximum that stage can
// cost (app/lib/stageMaximums.ts): the maximum of the ORC's, of the time column
// and of the merk column. A crew is not scored on a stage they handed no card in
// for, so leaving it out would put them ahead of the whole field on a fraction
// of the points — and would make handing in a card worse than handing in
// nothing. Those stages are marked `missingSheet` so the screen and the paper
// can say where the points came from.
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
//     whole rally. They are listed behind the DNF's, because a crew who rode and
//     retired is ahead of one who never came to the start.
//
// A crew is on this list when the entry list holds them or when a sheet names
// them, so a DNS is in the results as a DNS rather than missing from them.
//
// Each entry also carries the participant's class and crew names when they have
// been recorded, so the table can show who an EQ is.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  try {
    await dbConnect();

    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    // The stages in running order — their creation order, the same sort the
    // re-scoring uses — so the per-stage parts below come back in the order the
    // rally is ridden and a result sheet can head a column with its stage.
    // The keys come with them: the maximum a stage can cost is read off its
    // keys, and that is what a crew with no sheet for the stage is charged.
    const stages = await Stage.find({ rallyId: id })
      .select('name scoreKey timeScoreKey merkScoreKey timeConfig')
      .sort({ createdAt: 1, _id: 1 });
    const totalStages = stages.length;
    const sheets = await AnswerSheet.find({ rallyId: id });
    const participants = await Participant.find({ rallyId: id });

    const detailsByEq = new Map<
      number,
      { classification?: string; driverName?: string; navigatorName?: string }
    >(participants.map((participant) => [participant.eq, participant]));

    // Aggregate penalties per participant. `totalPenalty` on a sheet already
    // covers the ORC's, the time and the merk part; all three are carried
    // separately so the table can show where the points came from. The ORC's
    // part is what is left of the stored total after the stored time and merk
    // parts — they are written together by app/lib/rescore.ts, so no sheet has
    // to be re-scored here.
    //
    // The same three parts are kept per stage as well (`stagePenalties`, keyed
    // by stage id): one sheet is one stage, so a crew's rally total is these
    // added up. It lets a result sheet show what a stage cost a crew instead of
    // only what the rally did. A stage a crew has no sheet for is filled in
    // below with what that stage can cost at worst, marked `missingSheet`.
    type StageScore = {
      totalPenalty: number;
      orcPenalty: number;
      timePenalty: number;
      merkPenalty: number;
      disqualified: boolean;
      // True when this is not a scored card but the stage's maximum, charged
      // because the crew has no sheet for the stage at all.
      missingSheet: boolean;
    };

    const byParticipant = new Map<
      number,
      {
        eq: number;
        totalPenalty: number;
        orcPenalty: number;
        timePenalty: number;
        merkPenalty: number;
        stagePenalties: Record<string, StageScore>;
        sheetsSubmitted: number;
        // The stages this crew handed no card in for — the ones charged at the
        // stage maximum below.
        missingSheets: number;
        // Set from the cards: the crew was outside the finish window of the last
        // stage, or had no finish time on it. One of the two ways to be a DNF.
        disqualified: boolean;
        status: StandingsStatus;
      }
    >();

    // A crew of this rally, created the first time a sheet or the entry list
    // names them. `status` is decided once every sheet has been counted.
    const entryFor = (eq: number) => {
      const existing = byParticipant.get(eq);
      if (existing) return existing;

      const created = {
        eq,
        totalPenalty: 0,
        orcPenalty: 0,
        timePenalty: 0,
        merkPenalty: 0,
        stagePenalties: {} as Record<string, StageScore>,
        sheetsSubmitted: 0,
        missingSheets: 0,
        disqualified: false,
        status: 'finished' as StandingsStatus,
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

    // A stage a crew has no sheet for costs the maximum of that stage. The
    // maximums are read off the keys once — they are the same for every crew —
    // and then added to each crew that is short of that stage's card. The time
    // maximum needs to know whether the stage is the last one of the rally,
    // because the break after a stage is lost with its finish.
    const maxByStage = new Map(
      stages.map((stage, index) => [
        String(stage._id),
        stageMaxPenalties(stage, index === stages.length - 1),
      ])
    );

    for (const entry of byParticipant.values()) {
      for (const [stageId, max] of maxByStage) {
        if (entry.stagePenalties[stageId]) continue;

        entry.stagePenalties[stageId] = {
          totalPenalty: max.totalPenalty,
          orcPenalty: max.orcPenalty,
          timePenalty: max.timePenalty,
          merkPenalty: max.merkPenalty,
          // The stage costs its maximum; whether the crew is out of the rally is
          // decided below, on whether they have a card for the *last* stage.
          disqualified: false,
          missingSheet: true,
        };
        entry.totalPenalty += max.totalPenalty;
        entry.orcPenalty += max.orcPenalty;
        entry.timePenalty += max.timePenalty;
        entry.merkPenalty += max.merkPenalty;
        entry.missingSheets += 1;
      }
    }

    // Did they start, and did they finish? A crew with no card at all never
    // started; a crew whose last stage has no card, or whose last card puts them
    // outside the finish window, started but did not finish.
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
    const standings = Array.from(byParticipant.values())
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
          rank: index + 1,
        };
      });

    return NextResponse.json({
      totalStages,
      stages: stages.map((stage) => ({ _id: String(stage._id), name: stage.name })),
      standings,
    });
  } catch (error) {
    console.error('Failed to compute standings:', error);
    return NextResponse.json({ error: 'Failed to compute standings' }, { status: 500 });
  }
}
