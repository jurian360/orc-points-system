import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { User } from '../../../models';
import { readBody, requireSession } from '../../../lib/api-guard';
import { verifyPassword } from '../../../lib/passwords';
import { duplicateAccountField } from '../../../lib/users';
import { parseOptionalEmail } from '../../../lib/validation';
import { EMAIL_RULE, MAX_PASSWORD_LENGTH } from '../../../lib/roles';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import { ENV_ADMIN_SUBJECT } from '../../../lib/session';

// POST /api/auth/email — set or change your own email.
//
// Any signed-in official, whatever their role: this is what makes forgot-
// password self-service rather than gated behind an admin filling it in on
// /users. The current password is required for the same reason
// /api/auth/password asks for it: an email on the account is a path to a full
// takeover through a reset link, so a borrowed, unlocked browser must not be
// able to redirect one to an attacker's inbox on its own.
const CHANGE_ATTEMPT_LIMIT = 10;
const CHANGE_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { ok, retryAfter } = rateLimit(
    `email:${clientIp(request)}`,
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

  const { currentPassword } = parsed.body;

  if (typeof currentPassword !== 'string' || currentPassword.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
  }

  const email = parseOptionalEmail(parsed.body.email);
  if (email === null) {
    return NextResponse.json({ error: `Invalid email. ${EMAIL_RULE}` }, { status: 400 });
  }

  // Its credential lives in the environment, not a document, so there is
  // nothing here to write — the same rule /api/auth/password follows.
  if (session.user.sub === ENV_ADMIN_SUBJECT) {
    return NextResponse.json(
      {
        error:
          'This account is configured in the deployment environment and has no email on file.',
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

    // '' stores as undefined, never as an empty string: the unique index is
    // `sparse`, which only skips a missing field, not an empty one.
    user.email = email || undefined;
    await user.save();

    return NextResponse.json({ success: true, email: user.email ?? '' });
  } catch (error) {
    if (duplicateAccountField(error) === 'email') {
      return NextResponse.json({ error: 'That email address is already in use' }, { status: 409 });
    }

    console.error('Email change failed:', error);
    return NextResponse.json({ error: 'Failed to change the email' }, { status: 500 });
  }
}
