import 'server-only';

// The bridge between the officials' web app and the participants' Android app.
//
// A participant has no account: what identifies them is the QR code an official
// prints for them. One code stands for exactly one card — one {rally, stage,
// eq} — and it is the only thing their phone is given. This module mints those
// codes and resolves them back.
//
// Three identifiers travel to the phone and have to survive the round trip,
// because the app sends them back when the card is handed in and nothing else
// comes with it:
//
//   rallycode  the rally's short `code`, which the app also shows as the card's
//              name in its list
//   kaartid    the stage's `cardId` — stable, unlike its place in the running
//              order, which shifts when a stage is deleted
//   equipenr   the participant's EQ number, which already identifies a crew
//              within a rally
//
// The app's data types are integers, so both numbers are plain numbers rather
// than the ObjectIds they stand for.

import { CardAccess, Rally, Stage } from '../models';
import { slugFromName } from './rallyCodes';

// Unambiguous characters only: no I/L/O/U, no 0/1. The code is printed under
// the QR so a participant whose camera will not focus can type it in.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

// How many times to retry a mint that lost a race for the unique index.
const MINT_ATTEMPTS = 5;

// The QR the participant scans. `ADD:` is the prefix the Android app strips
// when it reads a code that was scanned rather than typed.
export const CARD_QR_PREFIX = 'ADD:';

export function cardQrPayload(code: string): string {
  return `${CARD_QR_PREFIX}${code}`;
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);

  let code = '';
  for (const byte of bytes) {
    // 256 is not a multiple of 30, so the low values are very slightly more
    // likely. That bias is irrelevant for a code that only has to be unguessable
    // among the few hundred live at one event.
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

// A code as it arrives from the app, either scanned or typed by hand. Anything
// that is not the exact shape this module mints is rejected before it reaches a
// query — the same rule the rest of the API follows.
export function parseAppCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized.length !== CODE_LENGTH) return null;
  for (const character of normalized) {
    if (!CODE_ALPHABET.includes(character)) return null;
  }
  return normalized;
}

// The stage's card number as the app sends it back.
export function parseCardId(value: unknown): number | null {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric)) return null;
  if (numeric < 1 || numeric > 10000) return null;
  return numeric;
}

// --- Rally code ------------------------------------------------------------

// The rally's public code, generated on first use. Rallies created before this
// existed have none, so every path that hands a code to the app goes through
// here rather than reading the field.
export async function ensureRallyCode(rally: {
  _id: unknown;
  name: string;
  code?: string;
  save: () => Promise<unknown>;
}): Promise<string> {
  if (rally.code) return rally.code;

  const base = slugFromName(rally.name);

  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    // The first attempt tries the bare slug; a collision falls back to a suffix
    // rather than to a second rally with the same code.
    const candidate =
      attempt === 0 ? base : `${base}-${randomCode().slice(0, 4)}`;

    // No `$ne` on the id here: `sanitizeFilter` is on globally
    // (app/lib/mongodb.ts) and would wrap the operator in `$eq`, which casts to
    // an ObjectId and throws. The rally that already holds this code is ruled
    // out in JS instead.
    const taken = await Rally.findOne({ code: candidate });
    if (taken && String(taken._id) !== String(rally._id)) continue;

    rally.code = candidate;
    try {
      await rally.save();
      return candidate;
    } catch (error) {
      // Another request minted the same code between the check and the save.
      if (error instanceof Error && 'code' in error && error.code === 11000) {
        rally.code = undefined;
        continue;
      }
      throw error;
    }
  }

  throw new Error('Could not generate a unique rally code');
}

// --- Stage card number -----------------------------------------------------

// The stage's stable card number within its rally, generated on first use.
// Numbers are handed out ascending and never reused, so deleting a stage does
// not renumber the cards a participant already scanned.
export async function ensureStageCardId(stage: {
  _id: unknown;
  rallyId: unknown;
  cardId?: number;
  save: () => Promise<unknown>;
}): Promise<number> {
  if (stage.cardId) return stage.cardId;

  // "The highest number + 1", read and then written, gave two stages printed
  // at the same moment the same number — and a submission is checked against
  // `{rally, cardId}`, so one stage's cards would silently land on the other's
  // sheets. The number now comes from the rally's own counter:
  //
  //  * `$max` first raises the counter to the highest number the stages
  //    already carry. Idempotent and never lowering, so any number of
  //    requests doing it at once agree, and a rally from before the counter
  //    existed carries on from its stages;
  //  * `$inc` then hands out the next number atomically — two requests get
  //    two numbers.
  const highest = await Stage.findOne({ rallyId: stage.rallyId })
    .sort({ cardId: -1 })
    .select('cardId');
  await Rally.updateOne(
    { _id: stage.rallyId },
    { $max: { cardIdSeq: highest?.cardId || 0 } }
  );
  const rally = await Rally.findOneAndUpdate(
    { _id: stage.rallyId },
    { $inc: { cardIdSeq: 1 } },
    { new: true, projection: { cardIdSeq: 1 } }
  );
  if (!rally) throw new Error('Rally of this stage not found');

  // Only a stage that still has no number takes this one: the same stage
  // numbered by two requests at once keeps the first number, which may already
  // be printed, and the other is left unused — a gap, never a collision.
  const assigned = await Stage.findOneAndUpdate(
    { _id: stage._id, cardId: null },
    { $set: { cardId: rally.cardIdSeq } },
    { new: true, projection: { cardId: 1 } }
  );
  const cardId = assigned
    ? (assigned.cardId as number)
    : ((await Stage.findById(stage._id).select('cardId'))?.cardId as number);

  stage.cardId = cardId;
  return cardId;
}

// --- Card access codes -----------------------------------------------------

// The models in app/models are untyped Mongoose documents, so the helpers here
// pass them through as-is rather than inventing a parallel type that would
// drift from the schema — the same shape app/lib/rescore.ts works with.
type CardAccessDocument = any;

// The code for one {stage, eq}, minted if it does not exist yet. Idempotent:
// calling it twice returns the same code, so an official can reprint a sheet
// without invalidating the QR a participant already scanned.
export async function ensureCardAccess(
  rallyId: unknown,
  stageId: unknown,
  eq: number
): Promise<CardAccessDocument> {
  const existing = await CardAccess.findOne({ stageId, eq });
  if (existing) return existing;

  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    try {
      return await CardAccess.create({ rallyId, stageId, eq, code: randomCode() });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 11000) {
        // Either the random code collided (retry with a new one) or another
        // request created the {stage, eq} record first (return theirs).
        const raced = await CardAccess.findOne({ stageId, eq });
        if (raced) return raced;
        continue;
      }
      throw error;
    }
  }

  throw new Error('Could not generate a unique card access code');
}

// Replace the code of one {stage, eq}: the printed sheet that carried the old
// one stops working. Also clears the submission lock, which is what an official
// does when a crew has to hand in again.
export async function reissueCardAccess(
  rallyId: unknown,
  stageId: unknown,
  eq: number
): Promise<CardAccessDocument> {
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    try {
      const reissued = await CardAccess.findOneAndUpdate(
        { stageId, eq },
        { $set: { rallyId, code: randomCode(), submittedAt: null, createdAt: new Date() } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      return reissued;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 11000) continue;
      throw error;
    }
  }

  throw new Error('Could not generate a unique card access code');
}

// --- Resolving a submission ------------------------------------------------

export interface ResolvedCard {
  rally: any;
  stage: any;
  eq: number;
  access: CardAccessDocument;
}

// Find the card a finalised submission belongs to. **The access code is the
// credential**, exactly as it is for the scan: the card is looked up by it and
// by nothing else. The rally code, the stage's card number and the EQ the app
// sends back are public — printed on the sheet, shown on the public results,
// numbered 1, 2, 3 — so they are only a consistency check here: they have to
// name the card the code stands for, or the phone is handing in against a card
// it was not issued. Any mismatch fails rather than guessing, and a code whose
// stage or rally is gone fails closed, as the scan does.
export async function resolveCard(
  code: string,
  rallyCode: string,
  cardId: number,
  eq: number
): Promise<ResolvedCard | null> {
  const access = await CardAccess.findOne({ code });
  if (!access || access.eq !== eq) return null;

  const [rally, stage] = await Promise.all([
    Rally.findById(access.rallyId),
    Stage.findById(access.stageId),
  ]);
  if (!rally || !stage) return null;

  if (rally.code !== rallyCode || stage.cardId !== cardId) return null;

  return { rally, stage, eq, access };
}
