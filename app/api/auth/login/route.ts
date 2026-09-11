import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import { readBody } from '../../../lib/api-guard';
import { burnPasswordTime } from '../../../lib/passwords';
import { authenticate } from '../../../lib/users';
import { MAX_PASSWORD_LENGTH } from '../../../lib/roles';
import { MAX_EMAIL_LENGTH } from '../../../lib/persons';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from '../../../lib/session';

// Brute-force budget. Keyed on the IP rather than the username on purpose:
// a per-username counter is a way for anyone to lock an official out of their
// own event on the morning of the rally.
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  // Rate limit before doing any work — including before parsing the body, so a
  // flood costs us as little as possible.
  const { ok, retryAfter } = rateLimit(
    `login:${clientIp(request)}`,
    LOGIN_ATTEMPT_LIMIT,
    LOGIN_WINDOW_MS
  );

  if (!ok) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;

  // Officials sign in with a username, riders with their e-mail address. One
  // field, because what was typed says which it is — a username cannot contain
  // `@` and an address must (see `authenticate`). The body's key is still
  // `username`: it is what the field means to whoever is typing in it.
  const { username, password } = parsed.body;

  // One refusal for every failure below: a wrong username, a wrong address, a
  // wrong password and a malformed field must be indistinguishable, or the
  // response is a way to find out which accounts exist.
  const invalid = NextResponse.json(
    { success: false, error: 'Invalid username or password' },
    { status: 401 }
  );

  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    // An address is the longer of the two identifiers, so it sets the bound.
    username.length > MAX_EMAIL_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return invalid;
  }

  try {
    // Handed over as typed: `authenticate` normalises it the way the identifier
    // it turns out to be is stored, and lower-casing a username here would
    // pre-empt a decision that is its to make.
    const user = await authenticate(username, password);

    if (!user) {
      // Spend the same scrypt time a real account costs, so the response time
      // does not separate "no such user" from "wrong password".
      await burnPasswordTime(password);
      return invalid;
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, await createSessionToken(user), {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return NextResponse.json({
      success: true,
      user: { username: user.username, role: user.role },
    });
  } catch (error) {
    // Configuration errors (no admin credential in the environment, a malformed
    // hash) and database failures land here. Log server-side; never reflect the
    // reason to the client.
    console.error('Login failed:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();

    // Overwrite with the same attributes before deleting so the browser
    // reliably replaces the cookie rather than keeping a differently-scoped one.
    cookieStore.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout failed:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
