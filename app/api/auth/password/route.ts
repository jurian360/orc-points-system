import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '../../../lib/mongodb';
import { Person, User } from '../../../models';
import { readBody, requireAnyAccount } from '../../../lib/api-guard';
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
// Anybody signed in, whatever their role and **whichever collection they are
// in**: an official changing theirs and a rider changing theirs are the same
// request about their own account. It is the one route guarded by
// `requireAnyAccount()` for exactly that reason — everything else either runs
// the rally (officials) or reads one rider's own results (`/api/me`).
//
// An admin resetting somebody *else's* password goes through
// PUT /api/users/[id] or PUT /api/persons/[id] instead, neither of which asks
// for the current password: an admin resets exactly the password nobody
// remembers.
//
// The current password is required even though the session already proves who
// this is: it is what stops a borrowed, unlocked browser from becoming a
// permanent account takeover.
const CHANGE_ATTEMPT_LIMIT = 10;
const CHANGE_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const session = await requireAnyAccount();
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

  const isRider = session.user.kind === 'participant';

  try {
    await dbConnect();

    // Officials are `User` documents and riders are `Person` documents. Which
    // one to read comes from the session's `kind`, never from the role or from
    // anything in the body: the id in `sub` belongs to one collection.
    const account = isRider
      ? await Person.findById(session.user.sub)
      : await User.findById(session.user.sub);

    if (!account) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // A rider an admin has not given a login to has no password to change.
    // Their session could not exist, so this is belt and braces — but reading a
    // null hash as "no password required" is the shape of bug worth closing at
    // the source.
    if (!account.passwordHash) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!(await verifyPassword(currentPassword, account.passwordHash))) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    account.passwordHash = await hashPassword(password);
    // Signs this account's *other* sessions out: the guards refuse a token
    // issued before this moment.
    account.passwordChangedAt = new Date();
    await account.save();

    // Re-issue this browser's cookie so whoever just changed their own password
    // is not signed out by their own change. A rider signs in with their
    // address, so that is what their session is named with.
    const cookieStore = await cookies();
    cookieStore.set(
      SESSION_COOKIE,
      await createSessionToken({
        sub: String(account._id),
        username: isRider ? account.email : account.username,
        kind: session.user.kind,
        role: session.user.role,
      }),
      { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_SECONDS }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Password change failed:', error);
    return NextResponse.json({ error: 'Failed to change the password' }, { status: 500 });
  }
}
