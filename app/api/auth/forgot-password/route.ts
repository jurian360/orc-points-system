import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { User } from '../../../models';
import { readBody } from '../../../lib/api-guard';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import { parseEmail } from '../../../lib/validation';
import { generateResetToken, hashResetToken, RESET_TOKEN_TTL_MS } from '../../../lib/passwordReset';
import { sendPasswordResetEmail } from '../../../lib/email';
import { requireEnv } from '../../../lib/env';

// POST /api/auth/forgot-password — request a reset link by email.
//
// Public, like /api/auth/login: a visitor asking for this has no session yet.
// It answers `{ success: true }` for every request that is merely well-formed,
// whether or not the address belongs to an account — exactly the login route's
// "one message for every failure" rule, extended to email enumeration. Nothing
// here ever tells the caller which addresses have an account.
const FORGOT_ATTEMPT_LIMIT = 5;
const FORGOT_WINDOW_MS = 15 * 60 * 1000;

// How long a freshly mailed link is left alone. Every request used to mint a
// new token and so kill the one before it, which let anybody who knew an
// official's address keep invalidating the link they were about to click. A
// request inside this window is answered the same way and does nothing: the
// link already on its way to that inbox keeps working. It only delays a real
// second request by minutes, while it stops the griefing outright.
const RESET_LINK_COOLDOWN_MS = 5 * 60 * 1000;

// The fields of a `User` document this touches. The models are untyped Mongoose
// schemas, so the document is named by what is used rather than by a type
// that would have to be kept in step with the schema.
interface ResetTarget {
  email: string;
  resetTokenHash?: string | null;
  resetTokenExpiresAt?: Date | null;
  save: () => Promise<unknown>;
}

// Mint a reset token for this account, store its hash and mail the link —
// unless a link went out moments ago (see RESET_LINK_COOLDOWN_MS).
async function issueResetLink(user: ResetTarget): Promise<void> {
  const expiresAt = user.resetTokenExpiresAt ? new Date(user.resetTokenExpiresAt).getTime() : 0;
  const issuedAt = expiresAt - RESET_TOKEN_TTL_MS;
  if (expiresAt > Date.now() && Date.now() - issuedAt < RESET_LINK_COOLDOWN_MS) return;

  const token = generateResetToken();
  user.resetTokenHash = hashResetToken(token);
  user.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save();

  const baseUrl = requireEnv('APP_BASE_URL').replace(/\/+$/, '');
  await sendPasswordResetEmail(user.email, `${baseUrl}/reset-password?token=${token}`);
}

export async function POST(request: NextRequest) {
  const { ok, retryAfter } = rateLimit(
    `forgot-password:${clientIp(request)}`,
    FORGOT_ATTEMPT_LIMIT,
    FORGOT_WINDOW_MS
  );

  if (!ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const generic = NextResponse.json({ success: true });

  const email = parseEmail(parsed.body.email);
  // An unparseable address cannot belong to any account either, so this is
  // still the same generic answer, not a 400 — a 400 here would itself be a
  // signal the login route is careful never to give.
  if (!email) return generic;

  try {
    await dbConnect();

    // The environment admin has no document at all, so it can never match
    // here — its credential lives in the environment and is changed there,
    // the same rule /api/auth/password already follows.
    //
    // A deactivated account gets no link either: it cannot sign in, so it
    // must not be able to set a password and walk back into the app shell.
    // Filtered here rather than in the query because `sanitizeFilter` would
    // strip the `$ne` an `active: { $ne: false }` filter needs.
    const user = await User.findOne({ email });
    if (user && user.active !== false) {
      // Not awaited — the token write included, not only the send. The lookup
      // above is the one thing both branches do; anything more on the response
      // path for an address that has an account (a save is a round trip to the
      // database, Postmark a network call) makes that answer measurably slower
      // than the one for an address that has none, the very enumeration this
      // route's generic response is built to avoid. This runs to completion
      // regardless: the app is one long-lived Node process (see COOLIFY.md),
      // not a short-lived function that gets torn down after the response.
      issueResetLink(user).catch((error) => {
        console.error('Forgot-password link could not be issued:', error);
      });
    }
  } catch (error) {
    // A missing APP_BASE_URL configuration or a database error must not
    // change what the caller sees, or the response itself becomes a way to
    // probe which addresses exist. Log it; answer the same generic success.
    console.error('Forgot-password request failed:', error);
  }

  return generic;
}
