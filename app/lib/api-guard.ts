import 'server-only';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSessionToken } from './session';
import { can, type Permission } from './roles';
import { currentUser, type AuthenticatedUser } from './users';
import { BodyTooLargeError, InvalidJsonError, readJsonBody } from './body';

// Per-handler guards.
//
// middleware.ts already rejects unauthenticated API requests and keeps a
// data-entry user off the admin pages. These run again inside each handler on
// purpose: middleware is a single matcher regex, and a future edit to it should
// not be able to silently unprotect the entire API. Authorization belongs next
// to the thing being protected.
//
// The role in the session cookie is only what the account had when it signed
// in. `currentUser()` re-reads the account here, so demoting or deleting
// somebody takes their access away on their next request rather than when their
// 24-hour token expires.

export type SessionResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; response: NextResponse };

// Any signed-in official. Returns the account so a handler can act on who is
// asking; `!result.ok` is the early-return every route starts with.
export async function requireSession(): Promise<SessionResult> {
  const unauthorized: SessionResult = {
    ok: false,
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };

  const cookieStore = await cookies();
  const session = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) return unauthorized;

  let user: AuthenticatedUser | null;
  try {
    // Re-reads the account, which touches the database for everyone but the
    // environment admin.
    user = await currentUser(session);
  } catch (error) {
    // A database failure is not an authentication failure: answering 401 would
    // send officials back to a login screen that cannot work either.
    console.error('Could not load the session user:', error);
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server error' }, { status: 500 }),
    };
  }

  if (!user) return unauthorized;

  return { ok: true, user };
}

// A signed-in official who holds `permission` (see app/lib/roles.ts).
//
// 403, not 404: the caller is a known official who may read the thing they are
// trying to change, so hiding its existence buys nothing and a clear refusal is
// what lets the UI say why.
export async function requirePermission(permission: Permission): Promise<SessionResult> {
  const result = await requireSession();
  if (!result.ok) return result;

  if (!can(result.user.role, permission)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return result;
}

// Everything that changes a rally: its name and code, its stages and their
// answer keys, the entry list, the imports, the QR codes and the re-score.
// Typing a participant's card is not one of these — that is what a data-entry
// account is for.
export function requireRallyAdmin(): Promise<SessionResult> {
  return requirePermission('manage:rally');
}

export function requireUserAdmin(): Promise<SessionResult> {
  return requirePermission('manage:users');
}

type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

// `maxBytes` raises the 256 KB cap for the one route that needs it (see
// RALLY_IMPORT_MAX_BODY_BYTES); every other route leaves it out.
export async function readBody(request: Request, maxBytes?: number): Promise<BodyResult> {
  try {
    const body = (await readJsonBody(request, maxBytes)) as Record<string, unknown>;
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
