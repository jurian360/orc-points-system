import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../lib/mongodb';
import { Rally, Stage } from '../../../../models';
import { requireSession } from '../../../../lib/api-guard';
import { buildStageScanReport, loadCrews, stageScanRadius } from '../../../../lib/scanReports';

// The anti-cheat overview of a whole rally: every stage's scan report boiled
// down to "how many crews scanned a route sign from somewhere that sign is
// not", and a line per crew that adds those up across the rally.
//
// A crew flagged once may have a phone with a bad fix. A crew flagged on four
// signs of three stages was handed photographs, and this is the page that says
// so — the detail behind each number is on the stage's own page.

interface StageSummary {
  _id: string;
  name: string;
  radiusMeters: number;
  signs: number;
  signsWithoutReference: number;
  scans: number;
  located: number;
  flagged: number;
  missing: number;
  typed: number;
  flaggedParticipants: number;
}

interface ParticipantSummary {
  eq: number;
  classification: string;
  driverName: string;
  navigatorName: string;
  scans: number;
  located: number;
  flagged: number;
  missing: number;
  // Letters on this crew's cards that no scan accounts for.
  letters: number;
  typed: number;
  // Which stages this crew was flagged on, and on which signs.
  flaggedStages: { stageId: string; stageName: string; signs: string[] }[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid rally ID' }, { status: 400 });
    }

    await dbConnect();

    const rally = await Rally.findById(id);
    if (!rally) {
      return NextResponse.json({ error: 'Rally not found' }, { status: 404 });
    }

    // Running order, the same order the stage list shows.
    const [stages, crews] = await Promise.all([
      Stage.find({ rallyId: rally._id }).sort({ createdAt: 1, _id: 1 }),
      loadCrews(rally._id),
    ]);

    const crewByEq = new Map(crews.map((crew) => [crew.eq, crew]));
    const byParticipant = new Map<number, ParticipantSummary>();
    const stageSummaries: StageSummary[] = [];

    for (const stage of stages) {
      const report = await buildStageScanReport(stage);

      stageSummaries.push({
        _id: String(stage._id),
        name: stage.name,
        radiusMeters: stageScanRadius(stage),
        signs: report.totals.signs,
        signsWithoutReference: report.totals.signsWithoutReference,
        scans: report.totals.scans,
        located: report.totals.located,
        flagged: report.totals.flagged,
        missing: report.totals.missing,
        typed: report.totals.typed,
        flaggedParticipants: report.totals.flaggedParticipants,
      });

      for (const entry of report.participants) {
        const crew = crewByEq.get(entry.eq);
        const summary = byParticipant.get(entry.eq) || {
          eq: entry.eq,
          classification: crew?.classification || '',
          driverName: crew?.driverName || '',
          navigatorName: crew?.navigatorName || '',
          scans: 0,
          located: 0,
          flagged: 0,
          missing: 0,
          letters: 0,
          typed: 0,
          flaggedStages: [],
        };

        summary.scans += entry.scans;
        summary.located += entry.located;
        summary.flagged += entry.flagged;
        summary.missing += entry.missing;
        summary.letters += entry.letters;
        summary.typed += entry.typed;

        if (entry.flaggedSigns.length > 0) {
          summary.flaggedStages.push({
            stageId: String(stage._id),
            stageName: stage.name,
            signs: entry.flaggedSigns,
          });
        }

        byParticipant.set(entry.eq, summary);
      }
    }

    // The crews an official is looking for come first.
    const participants = Array.from(byParticipant.values()).sort(
      (a, b) =>
        b.flagged - a.flagged ||
        b.flaggedStages.length - a.flaggedStages.length ||
        b.typed - a.typed ||
        b.missing - a.missing ||
        a.eq - b.eq
    );

    return NextResponse.json({
      rally: { _id: String(rally._id), name: rally.name },
      stages: stageSummaries,
      participants,
      totals: {
        scans: stageSummaries.reduce((total, stage) => total + stage.scans, 0),
        located: stageSummaries.reduce((total, stage) => total + stage.located, 0),
        flagged: stageSummaries.reduce((total, stage) => total + stage.flagged, 0),
        missing: stageSummaries.reduce((total, stage) => total + stage.missing, 0),
        typed: stageSummaries.reduce((total, stage) => total + stage.typed, 0),
        flaggedParticipants: participants.filter((entry) => entry.flagged > 0).length,
      },
    });
  } catch (error) {
    console.error('Failed to build the scan-location overview of a rally:', error);
    return NextResponse.json({ error: 'Failed to load the scan locations' }, { status: 500 });
  }
}
