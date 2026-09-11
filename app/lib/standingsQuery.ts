import 'server-only';

// The rally standings, computed once and shared by every reader of them:
// `GET /api/rallies/[id]/standings` (an official, at the dashboard) and
// `GET /api/public/rallies/[id]/results` (anyone, once an admin has turned
// the rally's public results page on — see app/lib/standings.ts and
// "Public results page" in CLAUDE.md). Extracted so the two routes cannot
// drift into two different rankings of the same rally.
//
// Returns null for a rally that does not exist; everything else about who may
// read the result is the caller's guard, not this function's.

import mongoose from 'mongoose';

import dbConnect from './mongodb';
import { Rally, AnswerSheet, Participant } from '../models';
import { blankSheetPenalties } from './missingSheets';
import { loadRunningOrder } from './rallyOrder';
import { resolveStatus, STATUS_ORDER, type StandingsStatus } from './standings';
import type { ClassificationValue } from './participants';

export interface StageScore {
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  disqualified: boolean;
  // True when there is no card behind these numbers: the crew has no sheet
  // for the stage, so it is scored as a blank one.
  missingSheet: boolean;
}

export interface RallyStandingsEntry {
  eq: number;
  classification: ClassificationValue | '';
  driverName: string;
  navigatorName: string;
  totalPenalty: number;
  orcPenalty: number;
  timePenalty: number;
  merkPenalty: number;
  stagePenalties: Record<string, StageScore>;
  sheetsSubmitted: number;
  missingSheets: number;
  disqualified: boolean;
  status: StandingsStatus;
  rank: number;
}

export interface RallyStandingsResult {
  rally: { _id: string; name: string; code?: string };
  totalStages: number;
  routes: { _id: string; name: string }[];
  stages: { _id: string; name: string; routeId: string | null }[];
  standings: RallyStandingsEntry[];
}

export async function computeRallyStandings(
  rallyId: string
): Promise<RallyStandingsResult | null> {
  if (!mongoose.Types.ObjectId.isValid(rallyId)) return null;

  await dbConnect();

  const rally = await Rally.findById(rallyId);
  if (!rally) return null;

  // The stages in running order — the routes in their order, and inside a
  // route the creation order of its stages, the same order the re-scoring
  // uses — so the per-stage parts below come back in the order the rally is
  // ridden. The keys come with them: a crew with no sheet for a stage is
  // scored on that stage as a blank card, which is scored against its keys.
  const { stages, routes, positionByStage } = await loadRunningOrder(
    rallyId,
    'name scoreKey timeScoreKey merkScoreKey timeConfig'
  );
  const totalStages = stages.length;
  const sheets = await AnswerSheet.find({ rallyId });
  const participants = await Participant.find({ rallyId });

  const detailsByEq = new Map<
    number,
    { classification?: string; driverName?: string; navigatorName?: string }
  >(participants.map((participant) => [participant.eq, participant]));

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
      missingSheets: number;
      disqualified: boolean;
      status: StandingsStatus;
    }
  >();

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

  // A rally with no stages yet has nothing to fail to start, so its standings
  // stay empty while it is being set up rather than filling with the whole
  // entry list as DNS.
  if (stages.length > 0) {
    for (const participant of participants) {
      entryFor(participant.eq);
    }
  }

  const blankByStage = new Map(
    stages.map((stage: any) => [
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

  const standings: RallyStandingsEntry[] = Array.from(byParticipant.values())
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
        classification: (details?.classification || '') as ClassificationValue | '',
        driverName: details?.driverName || '',
        navigatorName: details?.navigatorName || '',
        rank: index + 1,
      };
    });

  return {
    rally: { _id: String(rally._id), name: rally.name, code: rally.code || undefined },
    totalStages,
    routes: routes.map((route: any) => ({ _id: String(route._id), name: route.name })),
    stages: stages.map((stage: any) => ({
      _id: String(stage._id),
      name: stage.name,
      routeId: stage.routeId ? String(stage.routeId) : null,
    })),
    standings,
  };
}
