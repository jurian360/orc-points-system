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
    const user = await User.findOne({ email });
    if (user) {
      const token = generateResetToken();
      user.resetTokenHash = hashResetToken(token);
      user.resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await user.save();

      const baseUrl = requireEnv('APP_BASE_URL').replace(/\/+$/, '');
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      // Not awaited: a network call to Postmark takes far longer than the
      // lookup and save above, and awaiting it here would make an account
      // that exists measurably slower to answer than one that does not — a
      // timing side-channel around the exact enumeration this route's generic
      // response is built to avoid. This runs to completion regardless: the
      // app is one long-lived Node process (see COOLIFY.md), not a
      // short-lived function that gets torn down after the response.
      sendPasswordResetEmail(user.email, resetUrl).catch((error) => {
        console.error('Forgot-password email send failed:', error);
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
