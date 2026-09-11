import 'server-only';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSessionToken } from './session';
import { can, isOfficial, type Permission } from './roles';
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

// Anybody signed in at all — an official or a rider. Mostly the building block
// the two guards below are made of; a route uses it directly only when it acts
// on *your own account* whoever you are, which is `/api/auth/password` and
// nothing else. Everything that reads or writes rally data wants one of the
// two narrower guards.
export async function requireAnyAccount(): Promise<SessionResult> {
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

// Any signed-in **official**. Returns the account so a handler can act on who
// is asking; `!result.ok` is the early-return every route starts with.
//
// A rider's session is refused here, and that is the whole reason this is not
// simply `requireAnyAccount`. Riders hold a session now, and the twenty-odd read
// routes of the rally guard themselves with exactly this call — so the moment
// a `Person` could hold a session, "is signed in" stopped being the same
// question as "may read this rally's entry list". A participant reaches their
// own results through `/api/me/*` and `requireParticipant()` below, which
// authorises on *being* the rider whose data is being read rather than on
// holding a permission over everybody's.
//
// 403 rather than 401: the rider is perfectly well signed in, and answering
// 401 would bounce them to a login screen that cannot help them.
export async function requireSession(): Promise<SessionResult> {
  const result = await requireAnyAccount();
  if (!result.ok) return result;

  if (!isOfficial(result.user.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return result;
}

// A signed-in **rider**, for the `/api/me/*` routes. The handler then reads
// `user.sub` as the `Person` id whose own data it may return — never an id out
// of the request, which is what would turn "my results" into "anybody's".
export async function requireParticipant(): Promise<SessionResult> {
  const result = await requireAnyAccount();
  if (!result.ok) return result;

  if (result.user.kind !== 'participant') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return result;
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

// The rider registry: adding a person, correcting their address, contact
// details or login. An admin's, like everything else that is not typing a card.
export function requirePersonAdmin(): Promise<SessionResult> {
  return requirePermission('manage:persons');
}

// Setting the class a rider rides in. Held by an admin **and** by a
// classification admin — the one thing that role exists for. It moves a crew
// between the overall standings, so it is its own permission rather than a
// corner of `manage:persons`.
export function requireClassificationAdmin(): Promise<SessionResult> {
  return requirePermission('manage:classifications');
}

// Reading a stage's **answer key**. Split out of the plain read guard when the
// classification admin arrived: that official reads results and may not see the
// correct letters, so "is an official" stopped being enough to hand a key over.
export function requireKeyAccess(): Promise<SessionResult> {
  return requirePermission('view:keys');
}

// A stage with its answer key taken out: the correct letters, the timetable
// and the merk key replaced by empty ones.
//
// Withholding rather than refusing, because a classification admin's whole job
// is reading results and the stage *list* is how every page of a rally knows
// what its stages are called and in what order they run. Answering 403 there
// would break the rally dashboard for the one role that lives in the results.
//
// The keys come back **empty rather than absent** on purpose: a dozen client
// files do arithmetic over `stage.scoreKey`, and an empty key scores zero
// where a missing one throws. The pages that would show those zeros as if they
// meant something — the stage page and a participant's card — are in
// `RESTRICTED_PAGES` behind `view:keys`, so nobody reads a 0 that is really a
// withheld key.
export function withoutScoreKeys<T extends Record<string, unknown>>(stage: T) {
  const plain = typeof (stage as { toObject?: () => T }).toObject === 'function'
    ? (stage as unknown as { toObject: () => T }).toObject()
    : stage;

  return { ...plain, scoreKey: [], timeScoreKey: [], merkScoreKey: [] };
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
