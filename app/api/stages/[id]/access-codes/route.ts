import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';

import dbConnect from '../../../../lib/mongodb';
import { AnswerSheet, CardAccess, Participant, Rally, Stage } from '../../../../models';
import { readBody, requireRallyAdmin } from '../../../../lib/api-guard';
import { parseEq } from '../../../../lib/validation';
import { loadRunningOrder } from '../../../../lib/rallyOrder';
import {
  ensureCardAccess,
  ensureRallyCode,
  ensureStageCardId,
  reissueCardAccess,
} from '../../../../lib/appCards';

// The QR codes of one stage: one per participant of the rally, each standing
// for that crew's card for this stage. Officials print them; a participant
// scans theirs to pull the card into the Android app.
//
// Codes are minted, never derived, so this route is what the printing page
// reads and what the "generate" button writes.

interface CardRow {
  eq: number;
  code: string | null;
  classification: string;
  driverName: string;
  navigatorName: string;
  submittedAt: string | null;
  // The stage already holds a sheet for this crew — typed by an official, filled
  // by a time import, or handed in from the app.
  hasSheet: boolean;
}

// Everything the printing page needs: the stage's identifiers as the app will
// see them, and a row per participant of the rally.
async function buildResponse(rally: any, stage: any) {
  const [rallyCode, cardId, participants, accesses, sheets, order] = await Promise.all([
    ensureRallyCode(rally),
    ensureStageCardId(stage),
    Participant.find({ rallyId: rally._id }).sort({ eq: 1 }),
    CardAccess.find({ stageId: stage._id }),
    AnswerSheet.find({ stageId: stage._id }).select('eq'),
    loadRunningOrder(rally._id, '_id'),
  ]);

  const codeByEq = new Map<number, any>(accesses.map((access: any) => [access.eq, access]));
  const eqWithSheet = new Set<number>(sheets.map((sheet: any) => sheet.eq));

  const cards: CardRow[] = participants.map((participant: any) => {
    const access = codeByEq.get(participant.eq);
    return {
      eq: participant.eq,
      code: access ? access.code : null,
      classification: participant.classification || '',
      driverName: participant.driverName || '',
      navigatorName: participant.navigatorName || '',
      submittedAt: access?.submittedAt ? access.submittedAt.toISOString() : null,
      hasSheet: eqWithSheet.has(participant.eq),
    };
  });

  // The card's number is its place in the running order — the routes in their
  // order, and inside a route its stages in theirs. `cardId` is what the app
  // sends back; the position is only what the participant sees, which is why
  // routes may move it and may not move `cardId`.
  const position = order.positionByStage.get(String(stage._id))?.position || 0;

  return {
    rally: { _id: String(rally._id), name: rally.name, code: rallyCode },
    stage: {
      _id: String(stage._id),
      name: stage.name,
      cardId,
      cardNumber: position || cardId,
    },
    cards,
  };
}

// Load the stage of the request together with its rally, or the response that
// says why it could not be loaded.
async function loadStage(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { error: NextResponse.json({ error: 'Invalid stage ID' }, { status: 400 }) };
  }

  await dbConnect();

  const stage = await Stage.findById(id);
  if (!stage) {
    return { error: NextResponse.json({ error: 'Stage not found' }, { status: 404 }) };
  }

  const rally = await Rally.findById(stage.rallyId);
  if (!rally) {
    return { error: NextResponse.json({ error: 'Rally not found' }, { status: 404 }) };
  }

  return { stage, rally };
}

// GET /api/stages/[id]/access-codes — the participants of the rally with the
// code each of them has for this stage, if one has been generated.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Admin only, unlike most reads: these codes are the crews' credentials, and
  // handing them out is what the printed QR sheet does.
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  try {
    const { id } = await params;
    const loaded = await loadStage(id);
    if ('error' in loaded) return loaded.error;

    return NextResponse.json(await buildResponse(loaded.rally, loaded.stage));
  } catch (error) {
    console.error('Failed to fetch card access codes:', error);
    return NextResponse.json({ error: 'Failed to fetch card access codes' }, { status: 500 });
  }
}

// POST /api/stages/[id]/access-codes — three things officials do with the codes:
//
//   generate  mint a code for every participant that has none (the default).
//             Idempotent: an already printed QR keeps working.
//   reissue   replace one participant's code, which invalidates the sheet that
//             carried the old one, and clears their submission lock.
//   reopen    let a crew hand in again on the same code, after their card was
//             stored once.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireRallyAdmin();
  if (!session.ok) return session.response;

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const action = parsed.body.action === undefined ? 'generate' : parsed.body.action;
  if (action !== 'generate' && action !== 'reissue' && action !== 'reopen') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  let eq: number | null = null;
  if (action !== 'generate') {
    eq = parseEq(parsed.body.eq);
    if (eq === null) {
      return NextResponse.json(
        { error: 'eq must be an integer between 1 and 100' },
        { status: 400 }
      );
    }
  }

  try {
    const { id } = await params;
    const loaded = await loadStage(id);
    if ('error' in loaded) return loaded.error;

    const { rally, stage } = loaded;

    if (action === 'generate') {
      const participants = await Participant.find({ rallyId: rally._id }).sort({ eq: 1 });

      if (participants.length === 0) {
        return NextResponse.json(
          { error: 'This rally has no participants yet — import the entry list first' },
          { status: 400 }
        );
      }

      // Sequential on purpose: minting retries on a duplicate key, and a burst
      // of parallel inserts would race each other for no gain at this size.
      for (const participant of participants) {
        await ensureCardAccess(rally._id, stage._id, participant.eq);
      }
    } else if (action === 'reissue') {
      const participant = await Participant.findOne({ rallyId: rally._id, eq });
      if (!participant) {
        return NextResponse.json(
          { error: 'This rally has no participant with that EQ number' },
          { status: 404 }
        );
      }

      await reissueCardAccess(rally._id, stage._id, eq as number);
    } else {
      const reopened = await CardAccess.findOneAndUpdate(
        { stageId: stage._id, eq },
        { $set: { submittedAt: null } }
      );

      if (!reopened) {
        return NextResponse.json(
          { error: 'This participant has no code for this stage yet' },
          { status: 404 }
        );
      }
    }

    return NextResponse.json(await buildResponse(rally, stage));
  } catch (error) {
    console.error('Failed to update card access codes:', error);
    return NextResponse.json({ error: 'Failed to update card access codes' }, { status: 500 });
  }
}
