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
import { loadRunningOrder } from './rallyOrder';
import { buildStandings, type RallyStandingsResult } from './standingsBuild';

export type { StageScore, RallyStandingsEntry, RallyStandingsResult } from './standingsBuild';

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
  const { stages, routes } = await loadRunningOrder(
    rallyId,
    'name scoreKey timeScoreKey merkScoreKey timeConfig'
  );
  const sheets = await AnswerSheet.find({ rallyId });
  const participants = await Participant.find({ rallyId });

  return {
    rally: { _id: String(rally._id), name: rally.name, code: rally.code || undefined },
    ...buildStandings({ stages, routes, participants, sheets }),
  };
}
