import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '../../../lib/mongodb';
import { User } from '../../../models';
import { readBody } from '../../../lib/api-guard';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import { hashPassword } from '../../../lib/passwords';
import { parsePassword, parseResetToken } from '../../../lib/validation';
import { hashResetToken } from '../../../lib/passwordReset';
import { PASSWORD_RULE } from '../../../lib/roles';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from '../../../lib/session';

// POST /api/auth/reset-password — finish a forgot-password request.
//
// Public, like the request that started it: the token in the body is the
// whole credential, the same way the code behind a QR is for the Android app.
// Rate limited per IP so the token space (32 random bytes) cannot be brute
// forced by volume alone.
const RESET_ATTEMPT_LIMIT = 10;
const RESET_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const { ok, retryAfter } = rateLimit(
    `reset-password:${clientIp(request)}`,
    RESET_ATTEMPT_LIMIT,
    RESET_WINDOW_MS
  );

  if (!ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const invalid = NextResponse.json(
    { error: 'This reset link is invalid or has expired.' },
    { status: 400 }
  );

  const token = parseResetToken(parsed.body.token);
  if (!token) return invalid;

  const password = parsePassword(parsed.body.newPassword);
  if (!password) {
    return NextResponse.json({ error: `Invalid new password. ${PASSWORD_RULE}` }, { status: 400 });
  }

  try {
    await dbConnect();

    const user = await User.findOne({ resetTokenHash: hashResetToken(token) });
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
      return invalid;
    }

    user.passwordHash = await hashPassword(password);
    // Signs the account's other sessions out, exactly like a self-service or
    // an admin-driven password change: the point of a reset is usually that
    // somebody else may know the old password.
    user.passwordChangedAt = new Date();
    // One use: the link cannot be replayed once it has chosen a password.
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    await user.save();

    // Sign this browser in with the new password, the same courtesy
    // /api/auth/password extends to the account changing its own password —
    // whoever followed the emailed link lands back in the app, not at a
    // second login screen.
    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE,
      await createSessionToken({
        sub: String(user._id),
        username: user.username,
        role: user.role,
      }),
      { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_SECONDS }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Password reset failed:', error);
    return NextResponse.json({ error: 'Failed to reset the password' }, { status: 500 });
  }
}
