import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import dbConnect from '../../../lib/mongodb';
import { AnswerSheet, CardAccess } from '../../../models';
import { readBody } from '../../../lib/api-guard';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import { calculateMerkPenalty, calculateTotalPenalty } from '../../../lib/scoring';
import { rescoreParticipants } from '../../../lib/rescore';
import { parseAppCardRows, parseEq } from '../../../lib/validation';
import { parseCardId, resolveCard } from '../../../lib/appCards';
import { parseRallyCode } from '../../../lib/rallyCodes';

// A finalised card, handed in from the Android app.
//
// **This route is public**, for the same reason the lookup is: the participant
// has no session. What it accepts is therefore narrow:
//
//  * the card has to resolve to a {rally, stage, eq} an official printed a QR
//    code for — `resolveCard` refuses anything else;
//  * the code has to be unused. A card is handed in once; a second submission
//    is refused until an official reopens it from the QR page. That is what
//    keeps somebody who guesses a rally code and an EQ number from writing over
//    a crew's sheet after they handed in.
//
// Nothing about the scoring is taken from the phone: the app sends letters, the
// server grades them, exactly as it does for a sheet an official types.

const SUBMIT_RATE_LIMIT = 10;
const SUBMIT_RATE_WINDOW_MS = 60 * 1000;

export async function POST(request: NextRequest) {
  const { ok, retryAfter } = rateLimit(
    `app-submit:${clientIp(request)}`,
    SUBMIT_RATE_LIMIT,
    SUBMIT_RATE_WINDOW_MS
  );

  if (!ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;

  const rallyCode = parseRallyCode(body.rallyCode);
  if (!rallyCode) {
    return NextResponse.json({ error: 'Invalid rally code' }, { status: 400 });
  }

  // `cardId` is the stage's stable card number. The app also sends `cardNumber`,
  // the card's place in the running order, but that place moves when a stage is
  // deleted, so it is not what the card is resolved by.
  const cardId = parseCardId(body.cardId);
  if (cardId === null) {
    return NextResponse.json({ error: 'Invalid card number' }, { status: 400 });
  }

  const eq = parseEq(typeof body.eqNumber === 'string' ? Number(body.eqNumber) : body.eqNumber);
  if (eq === null) {
    return NextResponse.json(
      { error: 'eq must be an integer between 1 and 100' },
      { status: 400 }
    );
  }

  const rows = parseAppCardRows(body.rows);
  if (!rows) {
    return NextResponse.json({ error: 'Invalid card rows' }, { status: 400 });
  }

  try {
    await dbConnect();

    const card = await resolveCard(rallyCode, cardId, eq);
    if (!card) {
      return NextResponse.json({ error: 'Unknown card' }, { status: 404 });
    }

    const { rally, stage, access } = card;

    if (access.submittedAt) {
      return NextResponse.json(
        { error: 'This card has already been handed in' },
        { status: 409 }
      );
    }

    const existing = await AnswerSheet.findOne({ stageId: stage._id, eq });

    // A card that carries no merk column must not blank the letters an official
    // already typed there, so the merk rows are only written when they arrived.
    const merkScores = rows.merkScores ?? existing?.merkScores ?? [];
    const merkPenalty = calculateMerkPenalty(stage.merkScoreKey, merkScores).totalPenalty;
    // The time part is a chain across the rally and is added by the re-scoring
    // below, exactly as it is when an official saves a sheet.
    const totalPenalty = calculateTotalPenalty(stage.scoreKey, rows.answers) + merkPenalty;

    if (existing) {
      // The sheet may already exist because a control's times were imported for
      // this crew before they handed in. Their WPT's stay; only the letters and
      // the totals derived from them are written.
      existing.answers = rows.answers;
      existing.merkScores = merkScores;
      existing.merkPenalty = merkPenalty;
      existing.totalPenalty = totalPenalty;
      existing.submittedAt = new Date();
      await existing.save();
    } else {
      await AnswerSheet.create({
        eq,
        rallyId: rally._id,
        stageId: stage._id,
        answers: rows.answers,
        timePenalties: [],
        merkScores,
        merkPenalty,
        totalPenalty,
      });
    }

    // Writing a sheet moves this participant's whole time chain, so their rally
    // is re-scored before the standings are read again.
    await rescoreParticipants(rally._id, [eq]);

    // Only now is the code spent: a submission that failed to store should be
    // retryable from the phone.
    access.submittedAt = new Date();
    await access.save();

    return NextResponse.json({ ok: true, rallycode: rally.code, kaartid: stage.cardId, equipenr: eq });
  } catch (error) {
    // The unique {stageId, eq} index is the real guard against two phones
    // handing in the same card at once.
    if (error instanceof Error && 'code' in error && error.code === 11000) {
      return NextResponse.json(
        { error: 'This card has already been handed in' },
        { status: 409 }
      );
    }

    console.error('Failed to store a card handed in from the app:', error);
    return NextResponse.json({ error: 'Could not store this card' }, { status: 500 });
  }
}
