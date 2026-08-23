import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './app/lib/session';
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
    const authenticated = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

    if (!authenticated) {
      if (isApi) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Page request: send the visitor to the login screen. Pages are protected
      // here, at the edge, not only by the client-side gate in ClientLayout —
      // otherwise a Server Component added later would render real data to
      // anonymous visitors.
      return NextResponse.redirect(new URL('/login', request.url));
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
