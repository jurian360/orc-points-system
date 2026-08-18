import 'server-only';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from './session';
import { BodyTooLargeError, InvalidJsonError, readJsonBody } from './body';

// Per-handler guards.
//
// middleware.ts already rejects unauthenticated API requests. These run again
// inside each handler on purpose: middleware is a single matcher regex, and a
// future edit to it should not be able to silently unprotect the entire API.
// Authorization belongs next to the thing being protected.

export async function requireSession(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const authenticated = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);

  if (!authenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

export async function readBody(request: Request): Promise<BodyResult> {
  try {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    return { ok: true, body };
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Payload too large' }, { status: 413 }),
      };
    }
    if (error instanceof InvalidJsonError) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
      };
    }
    return {
      ok: false,
      response: NextResponse.json({ error: 'Could not read request body' }, { status: 400 }),
    };
  }
}
