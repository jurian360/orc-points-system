import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import dbConnect from '../../../lib/mongodb';
import { CardAccess, Participant, Rally, Stage } from '../../../models';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import { ensureRallyCode, ensureStageCardId, parseAppCode } from '../../../lib/appCards';

// The participants' half of the API: what the Android app calls when a QR code
// is scanned, or its code typed in by hand.
//
// **This route is public.** A participant has no account and no session cookie;
// the scanned code is the whole credential, which is why it is minted random
// (app/lib/appCards.ts) rather than derived from the EQ number, and why this
// handler is rate limited hard enough that codes cannot be enumerated.
//
// The response shape is the one the app already reads — see
// app/umbraco/surface/controlekaart/getEquipeByAppCode/route.ts for why the
// field names look the way they do.

// A participant scans once and, at worst, retypes a code a few times.
const CARD_RATE_LIMIT = 20;
const CARD_RATE_WINDOW_MS = 60 * 1000;

export async function GET(request: NextRequest) {
  const { ok, retryAfter } = rateLimit(
    `app-card:${clientIp(request)}`,
    CARD_RATE_LIMIT,
    CARD_RATE_WINDOW_MS
  );

  if (!ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = parseAppCode(searchParams.get('appcode'));

  // A malformed code and an unknown one get the same answer: a wrong code is a
  // wrong code, and saying which is which helps nobody but a guesser.
  if (!code) {
    return NextResponse.json({ error: 'Unknown code' }, { status: 404 });
  }

  try {
    await dbConnect();

    const access = await CardAccess.findOne({ code });
    if (!access) {
      return NextResponse.json({ error: 'Unknown code' }, { status: 404 });
    }

    const [rally, stage] = await Promise.all([
      Rally.findById(access.rallyId),
      Stage.findById(access.stageId),
    ]);

    // The stage or the rally was deleted after the sheet was printed.
    if (!rally || !stage) {
      return NextResponse.json({ error: 'Unknown code' }, { status: 404 });
    }

    const [rallyCode, cardId, participant, stages] = await Promise.all([
      ensureRallyCode(rally),
      ensureStageCardId(stage),
      Participant.findOne({ rallyId: rally._id, eq: access.eq }),
      Stage.find({ rallyId: rally._id }).sort({ createdAt: 1, _id: 1 }).select('_id'),
    ]);

    const position =
      stages.findIndex((entry: any) => String(entry._id) === String(stage._id)) + 1;

    const crew = [participant?.driverName, participant?.navigatorName]
      .filter((name) => Boolean(name))
      .join(' / ');

    return NextResponse.json({
      // What the app stores and sends back when the card is handed in.
      rallycode: rallyCode,
      equipenr: access.eq,
      equipeid: access.eq,
      kaartid: cardId,
      kaartnr: position || cardId,
      // Extra context the app does not read today, but which makes the response
      // legible on its own and gives a later version something to show.
      rallynaam: rally.name,
      kaartnaam: stage.name,
      equipenaam: crew,
      klasse: participant?.classification || '',
      // Whether this card has already been handed in on this code. The app does
      // not read it yet; the submit route is what enforces it.
      ingeleverd: Boolean(access.submittedAt),
    });
  } catch (error) {
    console.error('Failed to look up a card access code:', error);
    return NextResponse.json({ error: 'Could not look up this code' }, { status: 500 });
  }
}
