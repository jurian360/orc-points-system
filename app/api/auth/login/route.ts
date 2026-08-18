import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { requireEnv } from '../../../lib/env';
import { clientIp, rateLimit } from '../../../lib/rate-limit';
import { readBody } from '../../../lib/api-guard';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
} from '../../../lib/session';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

// Brute-force budget for the shared password. There is no per-user account to
// lock out, so the IP-keyed window is the only throttle available.
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const MAX_PASSWORD_LENGTH = 200;

// APP_PASSWORD_HASH is "<saltHex>:<hashHex>", produced by scripts/hash-password.mjs.
// The plaintext password is never stored, in source or in the environment.
function storedCredential(): { salt: Buffer; hash: Buffer } {
  const stored = requireEnv('APP_PASSWORD_HASH', 3);
  const [saltHex, hashHex] = stored.split(':');

  if (!saltHex || !hashHex) {
    throw new Error('APP_PASSWORD_HASH must be in "<saltHex>:<hashHex>" format.');
  }

  return { salt: Buffer.from(saltHex, 'hex'), hash: Buffer.from(hashHex, 'hex') };
}

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

  const password = parsed.body.password;

  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
  }

  try {
    const { salt, hash } = storedCredential();
    const derived = await scrypt(password, salt, hash.length);

    // Constant-time comparison. Comparing derived hashes rather than the
    // plaintext also means the comparison leaks nothing about password length.
    const match = derived.length === hash.length && timingSafeEqual(derived, hash);

    if (!match) {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, await createSessionToken(), {
      httpOnly: true,
      // Unconditional: a misconfigured NODE_ENV must not downgrade the session
      // cookie onto plaintext HTTP. Browsers treat localhost as a secure
      // context, so local development still works.
      secure: true,
      // Blocks the cross-site form post that would otherwise reach these
      // endpoints, since request.json() ignores Content-Type.
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Configuration errors (missing/!malformed APP_PASSWORD_HASH) land here.
    // Log server-side; never reflect the reason to the client.
    console.error('Login failed:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();

    // Overwrite with the same attributes before deleting so the browser
    // reliably replaces the cookie rather than keeping a differently-scoped one.
    cookieStore.set(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout failed:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
