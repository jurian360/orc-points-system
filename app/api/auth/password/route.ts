import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '../../../lib/mongodb';
import { User } from '../../../models';
import { readBody, requireSession } from '../../../lib/api-guard';
import { hashPassword, verifyPassword } from '../../../lib/passwords';
import { parsePassword } from '../../../lib/validation';
import { MAX_PASSWORD_LENGTH, PASSWORD_RULE } from '../../../lib/roles';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import {
  ENV_ADMIN_SUBJECT,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from '../../../lib/session';

// POST /api/auth/password — change your own password.
//
// Any signed-in official, whatever their role: this is their own account, not
// somebody else's. An admin resetting another user's password goes through
// PUT /api/users/[id] instead, which does not ask for the current password
// because an admin resets exactly the password nobody remembers.
//
// The current password is required even though the session already proves who
// this is: it is what stops a borrowed, unlocked browser from becoming a
// permanent account takeover.
const CHANGE_ATTEMPT_LIMIT = 10;
const CHANGE_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { ok, retryAfter } = rateLimit(
    `password:${clientIp(request)}`,
    CHANGE_ATTEMPT_LIMIT,
    CHANGE_WINDOW_MS
  );

  if (!ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  const { currentPassword, newPassword } = parsed.body;

  if (typeof currentPassword !== 'string' || currentPassword.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
  }

  const password = parsePassword(newPassword);
  if (!password) {
    return NextResponse.json({ error: `Invalid new password. ${PASSWORD_RULE}` }, { status: 400 });
  }

  // The break-glass account's password lives in the environment, not in a
  // document, so there is nothing here to write. Changing it means pasting a
  // new hash into Coolify — which is the point of it: it cannot be taken over
  // from inside the app.
  if (session.user.sub === ENV_ADMIN_SUBJECT) {
    return NextResponse.json(
      {
        error:
          'This account is configured in the deployment environment. ' +
          'Change ADMIN_PASSWORD_HASH there instead.',
      },
      { status: 400 }
    );
  }

  try {
    await dbConnect();

    const user = await User.findById(session.user.sub);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    user.passwordHash = await hashPassword(password);
    // Signs this account's *other* sessions out: `requireSession()` refuses a
    // token issued before this moment.
    user.passwordChangedAt = new Date();
    // Any forgot-password link still sitting in an inbox must not go on
    // working once the password it targeted has already been changed here.
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    await user.save();

    // Re-issue this browser's cookie so the official who just changed their own
    // password is not signed out by their own change.
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
    console.error('Password change failed:', error);
    return NextResponse.json({ error: 'Failed to change the password' }, { status: 500 });
  }
}
