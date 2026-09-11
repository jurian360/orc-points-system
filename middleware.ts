import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, readSessionToken } from './app/lib/session';
import { can, type Permission } from './app/lib/roles';
import { clientIp, rateLimit } from './app/lib/rate-limit';

// Paths reachable without a session. Everything else the matcher covers
// requires a valid, signed, unexpired session cookie.
const PUBLIC_PATHS = ['/login'];
const PUBLIC_API_PREFIX = '/api/auth/';

// The two endpoints the participants' Android app calls. They are public
// because a participant has no account: the code behind the QR they scanned is
// the whole credential (see app/api/app/card/route.ts).
const PUBLIC_APP_PREFIX = '/api/app/';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Pages only an admin may open. A data-entry account types cards and reads the
// standings; everything that changes the rally itself — its stages and keys,
// its entry list, the time import, the printed QR codes — and the user
// management is an admin's.
//
// This is the edge-side half of the check. The routes those pages call each run
// their own guard (app/lib/api-guard.ts), which is what actually protects the
// data: this only keeps an official from landing on a page whose every button
// would answer 403.
const RESTRICTED_PAGES: { pattern: RegExp; permission: Permission }[] = [
  { pattern: /^\/users(\/|$)/, permission: 'manage:users' },
  { pattern: /^\/time-import(\/|$)/, permission: 'manage:rally' },
  { pattern: /^\/rallies\/new$/, permission: 'manage:rally' },
  { pattern: /^\/rallies\/[^/]+\/edit$/, permission: 'manage:rally' },
  { pattern: /^\/rallies\/[^/]+\/stages\/new$/, permission: 'manage:rally' },
  { pattern: /^\/rallies\/[^/]+\/stages\/[^/]+\/edit$/, permission: 'manage:rally' },
  { pattern: /^\/rallies\/[^/]+\/stages\/[^/]+\/qr-codes$/, permission: 'manage:rally' },
  // A stage page *is* its answer key, and a participant's card page scores
  // itself against one — `ControlekaartCard` recomputes the ORC and merk
  // totals from the stage keys rather than reading the stored total. An
  // official without `view:keys` has the keys withheld by the stage routes, so
  // both pages would render a column of zeros that look like real scores.
  // Refused outright instead: "not you" beats a wrong number.
  { pattern: /^\/rallies\/[^/]+\/stages\/[^/]+$/, permission: 'view:keys' },
  { pattern: /^\/rallies\/[^/]+\/participants\/[^/]+$/, permission: 'view:keys' },
  // Typing a card is a data-entry official's job and an admin's; a
  // classification admin does neither.
  { pattern: /^\/rallies\/[^/]+\/answer-sheets(\/|$)/, permission: 'enter:sheets' },
];

// The permission a page needs, or null when any signed-in official may open it.
//
// The rider register (`/persons`) and the overall standings are deliberately
// **not** here: both are read pages whose buttons are gated in the component
// and whose routes are guarded, the same arrangement the rally dashboard has.
function requiredPermission(pathname: string): Permission | null {
  return RESTRICTED_PAGES.find(({ pattern }) => pattern.test(pathname))?.permission ?? null;
}

// The pages a **participant** may open. Everything else in this app belongs to
// the officials, so for a rider this is an allow-list rather than the
// exception-list above: a role with no permissions would otherwise sail
// straight past `requiredPermission`, which only ever refuses.
//
// The API half of the same rule is `requireSession()` in app/lib/api-guard.ts,
// which refuses a rider on every official route. This keeps them off the pages
// that would call those routes and render as a wall of 403s.
const PARTICIPANT_PAGES = [/^\/participant(\/|$)/, /^\/account(\/|$)/, /^\/forbidden(\/|$)/];

// The API a participant may reach: their own data, and signing in and out.
const PARTICIPANT_API = [/^\/api\/me(\/|$)/, /^\/api\/auth\//];

function participantMayOpen(pathname: string, isApi: boolean): boolean {
  return (isApi ? PARTICIPANT_API : PARTICIPANT_PAGES).some((pattern) =>
    pattern.test(pathname)
  );
}

// Coarse per-IP ceiling across the whole API, on top of the stricter
// per-endpoint limit on login.
const API_RATE_LIMIT = 120;
const API_RATE_WINDOW_MS = 60 * 1000;

// Same-origin check for mutating requests.
//
// Compares the Origin header against the *forwarded host* rather than against
// request.nextUrl.origin. Behind Coolify's TLS-terminating proxy the app sees
// an internal http:// origin while the browser sends the public https:// one,
// so comparing full origins would reject every legitimate mutation.
//
// Trusting x-forwarded-host is safe for this purpose: a browser cannot set it
// cross-origin, and an attacker who can set arbitrary headers could simply omit
// Origin instead — this check only ever defends against browser-driven CSRF.
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');

  // Non-browser clients (curl, server-to-server) send no Origin at all. The
  // session cookie is still required, so this is not a bypass.
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  return Boolean(host) && originHost === host;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isAppApi = pathname.startsWith(PUBLIC_APP_PREFIX);

  // CSRF defense in depth. The session cookie is SameSite=Lax, which already
  // blocks cross-site form posts, but `request.json()` parses any content type,
  // so a Lax-exempt request should still be refused.
  //
  // The app endpoints are exempt: they are cross-origin by nature (a phone, not
  // a page on this site) and there is no ambient authority for a forged request
  // to ride on — they carry no session cookie and authorise on the scanned code
  // alone.
  if (UNSAFE_METHODS.has(request.method) && !isAppApi && !isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 });
  }

  if (isApi) {
    const { ok, retryAfter } = rateLimit(
      `api:${clientIp(request)}`,
      API_RATE_LIMIT,
      API_RATE_WINDOW_MS
    );

    if (!ok) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }
  }

  const isPublic =
    pathname.startsWith(PUBLIC_API_PREFIX) || isAppApi || PUBLIC_PATHS.includes(pathname);

  if (!isPublic) {
    const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);

    if (!session) {
      if (isApi) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Page request: send the visitor to the login screen. Pages are protected
      // here, at the edge, not only by the client-side gate in ClientLayout —
      // otherwise a Server Component added later would render real data to
      // anonymous visitors.
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // A rider is only ever in their own half of the app. Checked before the
    // permission table below, because a participant holds no permission at
    // all: `requiredPermission` returns null for every page it does not name,
    // so on its own it would wave them through the whole rally.
    if (session.role === 'participant') {
      if (!participantMayOpen(pathname, isApi)) {
        if (isApi) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        // To their own dashboard rather than to /forbidden: there is nothing
        // for them to be refused *from*, they simply followed a link into the
        // officials' side of the app.
        return NextResponse.redirect(new URL('/participant', request.url));
      }

      return NextResponse.next();
    }

    // An official must not land on the riders' dashboard either. It reads
    // `/api/me`, which has no answer for them — an admin looking at a rider
    // opens that rider's page in the register instead.
    if (!isApi && PARTICIPANT_PAGES[0].test(pathname)) {
      return NextResponse.redirect(new URL('/persons', request.url));
    }

    // Role gating for pages. The role comes out of the signed cookie, which is
    // the role this account had when it signed in — there is no database on the
    // Edge to ask for a fresher one. That is why it is only the pages: every
    // API route re-reads the account before it writes anything, so a demotion
    // takes effect on the next request either way.
    if (!isApi) {
      const permission = requiredPermission(pathname);

      if (permission && !can(session.role, permission)) {
        return NextResponse.redirect(new URL('/forbidden', request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static assets. Auth API routes
     * and /login are allow-listed inside the middleware above rather than here,
     * so this exclusion list stays limited to things that are never protected.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
