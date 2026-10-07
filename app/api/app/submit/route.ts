import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import dbConnect from '../../../lib/mongodb';
import { AnswerSheet, CardAccess, Participant } from '../../../models';
import { readBody } from '../../../lib/api-guard';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import { calculateMerkPenalty, calculateTotalPenalty } from '../../../lib/scoring';
import { rescoreParticipants } from '../../../lib/rescore';
import { parseAppCardRows, parseEq } from '../../../lib/validation';
import { parseAppCode, parseCardId, resolveCard, type ResolvedCard } from '../../../lib/appCards';
import { parseRallyCode } from '../../../lib/rallyCodes';

// A finalised card, handed in from the Android app.
//
// **This route is public**, for the same reason the lookup is: the participant
// has no session. What it accepts is therefore narrow:
//
//  * the submission has to carry the access code the crew scanned. The code is
//    the credential here exactly as it is for the scan; the rally code, card
//    number and EQ that come with it are public, so `resolveCard` only checks
//    that they name the card the code stands for. Without this, anybody who read
//    a rally code off the public results could hand in every crew's card;
//  * the code has to be unused. A card is handed in once; a second submission
//    is refused until an official reopens it from the QR page, and *New code*
//    retires the old code altogether.
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

  // A version of the app from before it sent the code back sends none at all.
  // That is a phone to update, not a wrong guess, so it gets an answer the crew
  // can act on. A code that is there but wrong gets the same 404 as an unknown
  // card below — never which of the four values did not match.
  if (body.code === undefined || body.code === null || body.code === '') {
    return NextResponse.json(
      { error: 'This card carries no access code. Update the app and scan the card again.' },
      { status: 400 }
    );
  }

  const code = parseAppCode(body.code);
  if (!code) {
    return NextResponse.json({ error: 'Unknown card' }, { status: 404 });
  }

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

    const card = await resolveCard(code, rallyCode, cardId, eq);
    if (!card) {
      return NextResponse.json({ error: 'Unknown card' }, { status: 404 });
    }

    const { rally, stage, access } = card;

    // A sheet belongs to a crew on the entry list, exactly as for an official's
    // sheet and a time import. Deleting a participant takes their codes with
    // them now, but a code left behind by a deletion from before that — or one
    // whose participant was removed in the database — must not put a crew back
    // in the standings. Same answer as any card that does not resolve.
    if (!(await Participant.exists({ rallyId: rally._id, eq }))) {
      return NextResponse.json({ error: 'Unknown card' }, { status: 404 });
    }

    // Claim the hand-in lock *before* writing anything, in one atomic update.
    // Checking `access.submittedAt` on the document read above and setting it
    // after the write let any number of concurrent submissions all pass the
    // check and all write the sheet, the last one winning. Now exactly one
    // request can move the code from unused to spent; every other one gets the
    // 409. `claimedAt` identifies this claim, so releasing it below cannot undo
    // a later one.
    const claimedAt = new Date();
    const claimed = await CardAccess.findOneAndUpdate(
      { _id: access._id, submittedAt: null },
      { $set: { submittedAt: claimedAt } },
      { new: true }
    );
    if (!claimed) {
      return NextResponse.json(
        { error: 'This card has already been handed in' },
        { status: 409 }
      );
    }

    try {
      await storeCard(rally, stage, eq, rows);
    } catch (error) {
      // Nothing was handed in after all, so the code is released and the phone
      // can send the card again.
      await CardAccess.updateOne(
        { _id: access._id, submittedAt: claimedAt },
        { $set: { submittedAt: null } }
      );

      // The unique {stageId, eq} index: an official or a time import created
      // this crew's sheet in the moment between the lookup and the create. Not
      // a hand-in that already happened — the 409 would tell the app it was —
      // so the phone is asked to try again, and the retry updates that sheet.
      if (error instanceof Error && 'code' in error && error.code === 11000) {
        return NextResponse.json(
          { error: 'Could not store this card just now. Try again in a moment.' },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, rallycode: rally.code, kaartid: stage.cardId, equipenr: eq });
  } catch (error) {
    console.error('Failed to store a card handed in from the app:', error);
    return NextResponse.json({ error: 'Could not store this card' }, { status: 500 });
  }
}

// Write the letters of a card onto the crew's sheet for the stage and re-score
// their rally. Called only while this request holds the card's hand-in lock.
async function storeCard(
  rally: ResolvedCard['rally'],
  stage: ResolvedCard['stage'],
  eq: number,
  rows: NonNullable<ReturnType<typeof parseAppCardRows>>
): Promise<void> {
  const existing = await AnswerSheet.findOne({ stageId: stage._id, eq });

  // A card that carries no merk column must not blank the letters an official
  // already typed there, so the merk rows are only written when they arrived.
  const merkScores = rows.merkScores ?? existing?.merkScores ?? [];
  // The app has no Diversen row: a fine an official already wrote on the sheet
  // stays where it is.
  const merkPenalty = calculateMerkPenalty(
    stage.merkScoreKey,
    merkScores,
    existing?.diversenCount
  ).totalPenalty;
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
    // The crew changed the card: see `revision` in app/models/index.ts.
    existing.$inc('revision', 1);
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
}
