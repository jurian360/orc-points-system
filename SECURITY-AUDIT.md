# Security Audit — SARK Points System

**Scope:** Next.js 15.3.1 (App Router), React 19, Mongoose 8 / MongoDB
**Reviewed:** `middleware.ts`, `next.config.ts`, `app/api/**`, `app/lib/**`, `app/models/**`, all client components and pages, `Dockerfile`, `.env.local`, `COOLIFY.md`
**Date:** 2026-08-17

**Status:** All findings below have been remediated in code on this branch, except
three operator actions that cannot be done from the repository — see
[Remediation status](#remediation-status). Each finding keeps its original
description; the fix that shipped is recorded at the end.

> **Note on secrets in this document.** Live credentials and the application password are
> deliberately redacted here. They have since been removed from the working tree, but both
> remain in git history and must be treated as compromised until rotated — see CRITICAL-2 and
> CRITICAL-3.

---

## Summary

| Severity | Count | Findings |
| --- | --- | --- |
| **CRITICAL** | 3 | Forgeable session token (full auth bypass), committed database credentials, hardcoded application password |
| **HIGH** | 3 | No rate limiting, no server-side session expiry, insecure cookie configuration (CSRF) |
| **MEDIUM** | 5 | Missing security headers, NoSQL operator injection, missing `server-only` guards, unbounded request bodies, page routes outside the middleware matcher |
| **LOW** | 3 | Non-constant-time password comparison, error message reflection, silent database fallback |

The headline issue is **CRITICAL-1**: the session cookie carries no signature, so anyone can
mint a valid one in a single line of JavaScript. Every authorization control in the
application reduces to this one check, so the entire dataset — rallies, stages, answer keys,
participant sheets, and all destructive `DELETE` endpoints — is effectively public to anyone
who can reach the host. Fixing the credential exposure without fixing this leaves the
application fully open.

Injection and client-boundary hygiene, by contrast, are genuinely good — see
[Verified protections](#verified-protections).

---

## CRITICAL

### [CRITICAL] Session token is unsigned and trivially forgeable — complete authentication bypass

**Location:**
- `middleware.ts:21-29` (`middleware`)
- `app/api/auth/check/route.ts:12-19` (`GET`)
- `app/api/auth/login/route.ts:12` (token minting)

**Vulnerability Explanation:**
The session token is `base64(<timestamp>-authenticated)`. Both verification points accept
*any* cookie value whose base64 decoding contains the literal substring `-authenticated`:

```ts
const decoded = Buffer.from(session.value, 'base64').toString();
if (!decoded.includes('-authenticated')) { /* reject */ }
```

Base64 is an encoding, not a signature. There is no HMAC, no secret, no server-side session
store, and no lookup of any kind — the token is self-asserting. An attacker does not need to
guess the password, brute-force anything, or intercept a real session; they simply construct
the value. The `try/catch` around the decode is also dead code: `Buffer.from(x, 'base64')`
never throws, it silently discards non-alphabet characters.

Because `middleware.ts` is the *only* authorization layer in the application, and no route
handler performs its own check, forging this cookie grants full read and write access to every
endpoint — including `DELETE /api/rallies/[id]`, which cascades into deleting every stage and
answer sheet in the rally.

**Exploit Scenario:**
An attacker who has never seen the password and has no credentials runs:

```bash
# Verified against this codebase: base64("1-authenticated") == "MS1hdXRoZW50aWNhdGVk"
COOKIE='session=MS1hdXRoZW50aWNhdGVk'

# Read every rally
curl -H "Cookie: $COOKIE" https://target/api/rallies

# Exfiltrate a stage's answer key before the event runs
curl -H "Cookie: $COOKIE" https://target/api/stages/<stageId>

# Rewrite a competitor's score
curl -X PUT -H "Cookie: $COOKIE" -H 'Content-Type: application/json' \
  -d '{"answers":[]}' https://target/api/answersheets/<sheetId>

# Destroy the event
curl -X DELETE -H "Cookie: $COOKIE" https://target/api/rallies/<rallyId>
```

For this application the answer-key read is the highest-value target: a participant who pulls
`/api/stages/<id>` before a stage runs sees `scoreKey`, `timeScoreKey`, and `merkScoreKey` —
the complete solution — and can win the rally outright.

**Remediation:**
Sign the session with an HMAC over a payload that includes an expiry, and verify the signature
in constant time. Drop-in replacement:

```ts
// app/lib/session.ts
import 'server-only';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 random bytes');
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', SECRET!).update(payload).digest('base64url');
}

export function createSessionToken(): string {
  // jti makes each session individually identifiable (and revocable later).
  const payload = `${Date.now()}.${randomBytes(16).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;

  const idx = token.lastIndexOf('.');
  if (idx <= 0) return false;

  const payload = token.slice(0, idx);
  const provided = Buffer.from(token.slice(idx + 1));
  const expected = Buffer.from(sign(payload));

  if (provided.length !== expected.length) return false;
  if (!timingSafeEqual(provided, expected)) return false;

  // Server-side expiry — see HIGH-2.
  const issuedAt = Number(payload.split('.')[0]);
  if (!Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt < MAX_AGE_MS;
}
```

`middleware.ts` runs on the Edge runtime, where `node:crypto` is unavailable. Use Web Crypto
there:

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

async function verify(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return false;

  const payload = token.slice(0, idx);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(process.env.SESSION_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = Buffer.from(new Uint8Array(mac)).toString('base64url');

  // Length-equal comparison; crypto.subtle.verify is also acceptable here.
  if (expected.length !== token.length - idx - 1) return false;
  let diff = 0;
  const got = token.slice(idx + 1);
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  if (diff !== 0) return false;

  const issuedAt = Number(payload.split('.')[0]);
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < MAX_AGE_MS;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const ok = await verify(request.cookies.get('session')?.value);

  if (!ok) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // See MEDIUM-5: cover pages too, not just /api.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'],
};
```

Then use `verifySessionToken` in `app/api/auth/check/route.ts` and `createSessionToken()` in
the login handler. **Defense in depth:** middleware should not be the sole gate. Add a
`requireSession()` call at the top of every non-auth route handler so a future matcher
regression does not silently unprotect the API.

---

### [CRITICAL] Live MongoDB credentials committed to the repository

**Location:** `.env.local` (tracked in git as of commit `441fdaf`, "Push to server"); the same
host is echoed in `COOLIFY.md:20`

**Vulnerability Explanation:**
`.gitignore` explicitly opts *out* of ignoring env files (`# .env*`, commented out), and
`.env.local` containing a full `MONGODB_URI` — username `root`, a 64-character password, and
the internal host — is committed. Anyone with read access to the repository, now or at any
point in its history, has root credentials to the production database.

This is not remediated by deleting the file. The credential is in git history and must be
treated as compromised from the moment it was pushed. `COOLIFY.md` itself acknowledges the
problem but the file is still tracked.

The mitigating factor is real but thin: the host is an internal Coolify network name, not
publicly routable. That protects against an internet-wide attacker but not against anyone with
any foothold in that network, any other container on the same Coolify instance, or anyone who
clones the repository and later gains network access.

**Exploit Scenario:**
A contributor is granted read access to the repo, or the repository is made public, or a CI
log/fork/backup leaks the tree. The attacker extracts the URI from `.env.local` (or from
`git log -p -- .env.local` even after deletion), and — once on the Coolify network via any
other exposed service or a compromised sibling container — connects with `mongosh` as `root`.
Root on the MongoDB instance means read, modify, and drop on *every* database on that server,
not just this application's.

**Remediation:**
Rotate first, then clean up — in that order.

```bash
# 1. Rotate the MongoDB password in Coolify. The committed one is burned.

# 2. Set MONGODB_URI in the Coolify Environment Variables tab, not in a file.

# 3. Stop tracking the file and ignore it going forward.
git rm --cached .env.local
printf '\n# env files\n.env\n.env.*\n!.env.example\n' >> .gitignore
git commit -m "Stop tracking .env.local; ignore env files"

# 4. Purge from history (coordinate — this rewrites history for all clones).
git filter-repo --path .env.local --invert-paths
git push --force-with-lease origin --all
```

Commit a `.env.example` instead, carrying names only:

```bash
# .env.example
MONGODB_URI=mongodb://user:password@host:27017/orc-points-system?authSource=admin
APP_PASSWORD_HASH=
SESSION_SECRET=
```

Also remove the concrete host and password from `COOLIFY.md` — documentation is a secret sink
too. And create a least-privilege database user (`readWrite` on `orc-points-system` only)
rather than deploying with `root`.

---

### [CRITICAL] Application password hardcoded in source

**Location:** `app/api/auth/login/route.ts:4`; also reproduced verbatim in `COOLIFY.md:47`

**Vulnerability Explanation:**

```ts
const CORRECT_PASSWORD = '<REDACTED — see app/api/auth/login/route.ts:4>';
```

The single shared secret protecting the entire application is a string literal in a tracked
source file, compared with `===` against user input. Consequences:

1. Every person with repository read access knows the production password permanently.
2. Rotation requires a code change, a rebuild, and a redeploy — so in practice it never happens.
3. The value is compiled into the server bundle; anyone who obtains the built image (`docker
   pull`, a registry misconfiguration, a leaked artifact) can `grep` it out of
   `.next/standalone`.
4. It is duplicated in `COOLIFY.md`, so even redacting the source leaves it in the docs.

**Exploit Scenario:**
An attacker clones or is granted access to the repository — or pulls the built container image
from a registry — and runs `grep -r "CORRECT_PASSWORD" .`. They log in through the normal UI
as a legitimate administrator. Nothing distinguishes them from the real operator in any log,
because there are no per-user identities: authentication is a single shared secret, so all
actions are attributable only to "someone who knew the password."

**Remediation:**
Move to an environment-supplied *hash*, compared in constant time. Never store or compare the
plaintext.

```ts
// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { createSessionToken } from '@/app/lib/session';

const scrypt = promisify(_scrypt) as (
  pw: string, salt: Buffer, len: number
) => Promise<Buffer>;

// Format: "<saltHex>:<hashHex>". Generate once, store in APP_PASSWORD_HASH.
const STORED = process.env.APP_PASSWORD_HASH;
if (!STORED) throw new Error('APP_PASSWORD_HASH is not configured');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const password = body?.password;

    if (typeof password !== 'string' || password.length > 200) {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }

    const [saltHex, hashHex] = STORED!.split(':');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);

    // Constant-time — see LOW-1.
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set('session', createSessionToken(), {
      httpOnly: true,
      secure: true,        // see HIGH-3
      sameSite: 'lax',     // see HIGH-3
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
```

Generate the hash once, locally, and paste the output into Coolify:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16);\
c.scrypt(process.argv[1],s,64,(e,k)=>console.log(s.toString('hex')+':'+k.toString('hex')))" \
  'your-new-password'
```

Rotate the password as part of this change — the current one is public to everyone with repo
access.

---

## HIGH

### [HIGH] No rate limiting on the login endpoint or any API route

**Location:** `app/api/auth/login/route.ts:6` (`POST`); `middleware.ts:11-14` explicitly
allow-lists `/api/auth/*` past all checks

**Vulnerability Explanation:**
There is no throttling, lockout, backoff, CAPTCHA, or attempt logging anywhere in the
application. `POST /api/auth/login` accepts unlimited guesses at the shared password from a
single IP at whatever rate the network sustains. Because authentication is one shared secret
with no username, there is no account to lock and no anomaly signal to detect — a brute-force
attempt is indistinguishable from ordinary traffic.

The same absence applies to every other endpoint: an unauthenticated attacker can hammer
`/api/auth/check`, and an attacker holding a (trivially forged) session can issue unbounded
writes.

**Exploit Scenario:**
An attacker points a wordlist at the login endpoint:

```bash
while read pw; do
  curl -s -X POST https://target/api/auth/login \
    -H 'Content-Type: application/json' -d "{\"password\":\"$pw\"}" \
  | grep -q '"success":true' && echo "FOUND: $pw" && break
done < rockyou.txt
```

At a modest 50 requests/second this clears a 10-million-entry wordlist in under three days,
and common-password lists in seconds. Nothing in the application slows it down, and nothing
records that it happened. Separately, unthrottled `POST /api/answersheets` with large bodies
(see MEDIUM-4) is a cheap denial-of-service and storage-exhaustion vector.

**Remediation:**
Add a fixed-window limiter keyed on client IP. For a single-instance deployment an in-process
map is sufficient; move to Redis (`@upstash/ratelimit`) if you ever scale past one container.

```ts
// app/lib/rate-limit.ts
import 'server-only';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

// Bound memory: evict expired buckets periodically.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
}, 60_000).unref();

export function clientIp(request: Request): string {
  // Trust x-forwarded-for ONLY because Coolify's proxy sets it. Take the
  // left-most entry, and never trust this header on a directly-exposed origin.
  const xff = request.headers.get('x-forwarded-for');
  return xff?.split(',')[0].trim() || 'unknown';
}
```

At the top of the login handler:

```ts
const { ok, retryAfter } = rateLimit(`login:${clientIp(request)}`, 5, 15 * 60 * 1000);
if (!ok) {
  return NextResponse.json(
    { success: false, error: 'Too many attempts' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}
```

Also add a coarser global limit (e.g. 100 requests/minute per IP) in `middleware.ts` for all
`/api/*` routes, and log failed login attempts with IP and timestamp so brute-force attempts
become visible.

---

### [HIGH] Session never expires server-side

**Location:** `middleware.ts:22-27`; `app/api/auth/check/route.ts:13-16`;
`app/api/auth/login/route.ts:19` (`maxAge`)

**Vulnerability Explanation:**
`maxAge: 60 * 60 * 24` is an instruction to the *browser* to discard the cookie after 24
hours. It is not enforcement. The server never inspects the timestamp baked into the token —
it only checks that the decoded string contains `-authenticated`. A cookie value captured,
exported from a browser profile, or read from a log is valid forever.

There is also no revocation mechanism. Logout (`DELETE /api/auth/login`) calls
`cookieStore.delete('session')`, which only clears the client's copy; the token value itself
remains valid if the attacker recorded it. There is no way to invalidate an issued session
short of changing the signing secret and logging everyone out.

**Exploit Scenario:**
An operator logs in on a shared laptop at a rally event. Six months later, someone reads the
`session` cookie out of that browser profile (or out of a proxy log, an old HAR file, or a
screen recording), replays it, and is authenticated — long after the 24-hour window the
application believes it enforced, and long after the operator has stopped using the machine.

**Remediation:**
Validate the issued-at timestamp server-side on every request. The `verifySessionToken` and
Edge `verify` implementations in CRITICAL-1 already do this:

```ts
const issuedAt = Number(payload.split('.')[0]);
if (!Number.isFinite(issuedAt)) return false;
if (Date.now() - issuedAt >= MAX_AGE_MS) return false;
```

Because the timestamp is inside the HMAC-signed payload, an attacker cannot backdate or extend
it. For true revocation, add a server-side store: keep issued `jti` values in a MongoDB
`sessions` collection with a TTL index, check membership on each request, and delete the row
on logout.

---

### [HIGH] Insecure session cookie configuration — missing `SameSite`, conditional `Secure`

**Location:** `app/api/auth/login/route.ts:16-21`

**Vulnerability Explanation:**

```ts
cookieStore.set('session', sessionToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',   // conditional
  maxAge: 60 * 60 * 24,
  path: '/'
  // sameSite is absent
});
```

Two problems:

*No `SameSite`.* Next.js serializes no `SameSite` attribute when the option is omitted.
Browsers then apply their own default, which is inconsistent: Chrome and Edge apply
`Lax`-by-default, but with a two-minute exemption window that permits cross-site `POST` for
freshly-set cookies; Firefox does **not** enable Lax-by-default in release builds. So the
cookie is sent on cross-site requests for a meaningful share of users. Every mutating endpoint
is CSRF-exposed as a result, and none of them carries a CSRF token or an `Origin` check.

Content-Type is not a defense here. `await request.json()` parses the body regardless of the
declared content type, so an attacker can send a JSON body inside a `text/plain` form post —
a "simple request" that triggers no CORS preflight.

*Conditional `Secure`.* Tying `secure` to `NODE_ENV` means a misconfigured deployment (env var
unset, a staging box, a preview container) transmits the session cookie over plaintext HTTP,
where any on-path observer captures it. Given CRITICAL-1 and HIGH-2, a captured cookie is a
permanent master key.

**Exploit Scenario:**
An authenticated operator, browsing in Firefox, visits an attacker-controlled page:

```html
<form id="f" action="https://target/api/rallies" method="POST" enctype="text/plain">
  <input name='{"name":"pwned","x":"' value='"}'>
</form>
<script>f.submit()</script>
```

The browser attaches the `session` cookie because no `SameSite` restriction was set. The
request succeeds. Swapping the target for a `DELETE`-capable flow (via `fetch` with
`credentials: 'include'` where CORS permits, or an XHR override) lets the attacker destroy
rally data using the victim's authenticated browser — no password, no forged cookie, and
nothing unusual in the server logs.

**Remediation:**

```ts
cookieStore.set('session', createSessionToken(), {
  httpOnly: true,
  secure: true,        // unconditional; terminate TLS at the Coolify proxy
  sameSite: 'lax',     // 'strict' if no inbound cross-site links are needed
  maxAge: 60 * 60 * 24,
  path: '/',
});
```

`lax` blocks the cross-site form post above while preserving normal top-level navigation into
the app. Add an origin check in `middleware.ts` as defense in depth for mutating methods:

```ts
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

if (UNSAFE.has(request.method)) {
  const origin = request.headers.get('origin');
  const expected = request.nextUrl.origin;
  if (origin && origin !== expected) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 });
  }
}
```

If you keep `secure: true` unconditionally, note that local `http://localhost` development
still works — browsers treat localhost as a secure context.

---

## MEDIUM

### [MEDIUM] No security headers configured

**Location:** `next.config.ts:3-7` — the config contains only `output: "standalone"`; there is
no `headers()` function, and no headers are set in `middleware.ts` either

**Vulnerability Explanation:**
The application ships none of: `Content-Security-Policy`, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, or
`Permissions-Policy`.

Concretely this means the app is framable by any origin (clickjacking), any future XSS has no
CSP to contain it, responses can be MIME-sniffed, full URLs leak to third-party origins via
`Referer`, and there is no HSTS to prevent an initial plaintext request from being intercepted
and downgraded.

**Exploit Scenario:**
An attacker embeds the application in a transparent iframe overlaid on a decoy page ("Click to
see the rally results"). An operator who is already logged in — the session cookie rides along
because it is a same-site request from the browser's perspective — clicks what appears to be a
harmless button but is actually the "Delete Rally" control at `/rallies/<id>`. The cascade in
`app/api/rallies/[id]/route.ts:85-88` then removes every stage and answer sheet in that rally.
Nothing in the response tells the browser to refuse framing.

**Remediation:**

```ts
// next.config.ts
import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  // Next.js requires 'unsafe-inline' for its bootstrap; use a nonce via
  // middleware if you want to remove it. Tailwind v4 needs inline styles.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,   // drop the X-Powered-By: Next.js fingerprint
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

`frame-ancestors 'none'` and `X-Frame-Options: DENY` are both listed intentionally — the
former is the modern control, the latter covers older clients. Note that `next/font/google`
(used in `app/layout.tsx:2`) self-hosts fonts at build time, so no external font origin is
needed in the CSP.

---

### [MEDIUM] NoSQL operator injection via unvalidated `eq` in the duplicate check

**Location:** `app/api/answersheets/route.ts:64-67` (`POST`); related unvalidated input at
`app/api/answersheets/[id]/route.ts:52-57` (`PUT`)

**Vulnerability Explanation:**

```ts
const existing = await AnswerSheet.findOne({
  eq: body.eq,            // straight from JSON, never type-checked
  stageId: body.stageId,
});
```

`body.eq` is interpolated into a query without a type check. JSON permits objects, so an
attacker can supply `{"$gt": 0}` or `{"$ne": null}`, which Mongoose passes through as query
operators rather than as a scalar value. The `stageId` beside it *is* validated
(`ObjectId.isValid` at line 54), and Mongoose's schema casting limits this to operators whose
operands cast to `Number` — so this is not a full authentication-bypass-grade injection. It is
still an attacker-controlled query shape.

The `PUT` handler has a related gap: `sheet.eq = body.eq ?? sheet.eq` accepts arbitrary input,
and `body.answers`, `body.timePenalties`, and `body.merkScores` are assigned wholesale with no
shape validation. Mongoose's `save()` validators catch type violations, but only after the
document is built.

**Exploit Scenario:**
An attacker posts `{"stageId":"<valid ObjectId>","eq":{"$gt":0}}`. The duplicate check now
matches *any* existing sheet for that stage rather than the specific participant's. Two
outcomes, both undesirable: if any sheet exists, the endpoint returns "already has an answer
sheet" — a boolean oracle revealing whether that stage has submissions, without knowing any
participant number; if none exists, execution proceeds to `new AnswerSheet({ eq: {$gt: 0} })`,
which throws a Mongoose `CastError` and returns a 500. Repeating the first case against a
range of stage IDs enumerates which stages have been scored. It also blocks legitimate
submissions if an attacker can win the race on the check.

**Remediation:**
Validate and coerce every field before it reaches a query or a document. A small guard is
enough here — no schema library required:

```ts
// app/lib/validation.ts
import 'server-only';

export function parseEq(value: unknown): number | null {
  // Reject objects, arrays, booleans, null — anything that could carry an operator.
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > 100) return null;
  return value;
}

export function parseAnswerRows(value: unknown, maxRows: number) {
  if (!Array.isArray(value) || value.length > maxRows) return null;
  return value.map((row: any) => ({
    rowNumber: Number(row?.rowNumber) || 0,
    selectedAnswers: Array.isArray(row?.selectedAnswers)
      ? row.selectedAnswers.slice(0, 4).map((a: unknown) => String(a ?? '').slice(0, 16))
      : [],
    strafp: typeof row?.strafp === 'number' ? row.strafp : 0,
  }));
}
```

In the handler:

```ts
const eq = parseEq(body.eq);
if (eq === null) {
  return NextResponse.json(
    { error: 'eq must be an integer between 1 and 100' },
    { status: 400 }
  );
}

const answers = parseAnswerRows(body.answers, 50);
if (answers === null) {
  return NextResponse.json({ error: 'Invalid answers payload' }, { status: 400 });
}

const existing = await AnswerSheet.findOne({ eq, stageId: body.stageId });
```

As a global backstop, enable Mongoose's operator sanitization at connection time in
`app/lib/mongodb.ts`:

```ts
mongoose.set('sanitizeFilter', true);
```

Apply the same `parseEq` guard to the `PUT` handler and to
`app/api/answersheets/route.ts:37-39`, where `query.eq = Number(eq)` produces `NaN` for junk
input and surfaces a `CastError` as a 500.

---

### [MEDIUM] Missing `import 'server-only'` on backend modules

**Location:** `app/lib/mongodb.ts:1`; `app/models/index.ts:11`

**Vulnerability Explanation:**
Neither the database connection module (which reads `process.env.MONGODB_URI`) nor the
Mongoose model definitions carry an `import 'server-only'` guard. Today both are imported only
from route handlers, so nothing leaks — this is a latent risk, not an active exposure.

The guard matters because the failure mode is silent and severe. If a developer later imports
a type or helper from `app/models/index.ts` into a `'use client'` component — an easy mistake,
since `app/types/index.ts` and the models describe the same shapes — the module graph pulls
server code toward the client bundle. `server-only` turns that into a build-time error instead
of a runtime surprise.

Note that `app/lib/scoring.ts` is intentionally shared: it is imported by both
`app/api/answersheets/route.ts:4` and the client component
`app/components/AnswerSheetScoringView.tsx:3`. It must **not** get the guard. It contains no
secrets, only pure scoring arithmetic, so sharing it is correct.

**Exploit Scenario:**
A developer adds `import { AnswerSheet } from '@/app/models'` to a client component to reuse
an interface. The bundler follows the import into `mongoose` and, transitively, into
`app/lib/mongodb.ts`, pulling server-side database code into the client graph.

To be precise about the limits here: Next.js only inlines `NEXT_PUBLIC_*` variables into
client bundles — a bare `process.env.MONGODB_URI` evaluates to `undefined` client-side, so the
connection string itself is not what leaks. What does reach the browser is the server module's
own source: its query logic, schema shape, and any literal fallback baked into it. The old
`|| 'mongodb://localhost:27017/orc-points-system'` default (LOW-3) is exactly such a literal.

The stronger argument for the guard is the silence of the failure. Without it, nothing errors
and nothing warns — the app builds, ships, and only a reading of the output bundle reveals that
server code crossed the boundary. `server-only` converts that into a build failure at the
moment the bad import is written.

**Remediation:**

```bash
npm install server-only
```

```ts
// app/lib/mongodb.ts — first line
import 'server-only';
import mongoose from 'mongoose';
```

```ts
// app/models/index.ts — first line, above the mongoose import
import 'server-only';
import mongoose from 'mongoose';
```

Add the same guard to `app/lib/session.ts`, `app/lib/rate-limit.ts`, and `app/lib/validation.ts`
from the remediations above. Leave `app/lib/scoring.ts` unguarded — it is shared by design.

While here, drop the silent fallback in `app/lib/mongodb.ts:3` (see LOW-3).

---

### [MEDIUM] Unbounded request bodies and array sizes

**Location:** `app/api/answersheets/route.ts:50` and `:76-87`;
`app/api/stages/route.ts:52` and `:7-30` (`processScoreKey`); the same pattern in both `[id]`
route handlers

**Vulnerability Explanation:**
App Router route handlers impose no body-size limit by default — the 4 MB cap that Pages
Router API routes had does not apply. `await request.json()` buffers the entire body into
memory before any validation runs.

Beyond raw size, `processScoreKey` maps over `body.scoreKey`, `body.timeScoreKey`, and
`body.merkScoreKey` with no length ceiling, and copies `row.answers` and `row.falseAnswers`
through unbounded. The schema comments describe fixed shapes ("10 rows", "6 rows", "up to 4
answers"), but nothing enforces them — `app/models/index.ts` declares the arrays without
validators. Strings are unbounded too: `merk`, `ipt`, `wpt`, and `plusMinus` accept any length.

**Exploit Scenario:**
An attacker with a session — trivially obtained via CRITICAL-1 — posts a stage whose
`scoreKey` contains 500,000 rows, or a single row whose `answers` array holds a 10 MB string.
The server buffers and parses the whole payload, `processScoreKey` allocates a mapped copy,
and Mongoose builds the document — several multiples of the payload size resident at once.
Repeated concurrently against an unthrottled endpoint (HIGH-1), this exhausts the container's
memory and the Node process is OOM-killed. Persisted, the oversized documents also bloat the
database and slow every subsequent `Stage.find()`.

Worse, `PUT /api/stages/[id]` re-scores every answer sheet for the stage on each update
(`app/api/stages/[id]/route.ts:93-99`), issuing one `save()` per sheet with no batching — so a
large stage amplifies each write into hundreds of database round-trips.

**Remediation:**
Cap the body before parsing, and cap array lengths during normalization.

```ts
// app/lib/body.ts
import 'server-only';

const MAX_BODY_BYTES = 256 * 1024;   // 256 KB is generous for these payloads

export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }

  const text = await request.text();
  // content-length can be absent or wrong under chunked encoding — check actual bytes.
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new Error('PAYLOAD_TOO_LARGE');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
}
```

```ts
// In each handler
let body: any;
try {
  body = await readJsonBody(request);
} catch (e) {
  const tooLarge = (e as Error).message === 'PAYLOAD_TOO_LARGE';
  return NextResponse.json(
    { error: tooLarge ? 'Payload too large' : 'Invalid JSON' },
    { status: tooLarge ? 413 : 400 }
  );
}
```

Bound the arrays in `processScoreKey` (both copies — `app/api/stages/route.ts:7` and
`app/api/stages/[id]/route.ts:7` are duplicates and should be extracted into
`app/lib/` and shared):

```ts
const MAX_SCORE_ROWS = 100;
const MAX_ANSWERS_PER_ROW = 4;
const MAX_FIELD_LEN = 64;

const str = (v: unknown) => String(v ?? '').slice(0, MAX_FIELD_LEN);

function processScoreKey(body: any) {
  const scoreKey = (Array.isArray(body.scoreKey) ? body.scoreKey : [])
    .slice(0, MAX_SCORE_ROWS)
    .map((row: any) => ({
      rowNumber: Number(row?.rowNumber) || 0,
      answers: (Array.isArray(row?.answers) ? row.answers : [])
        .slice(0, MAX_ANSWERS_PER_ROW)
        .map(str),
      falseAnswers: (Array.isArray(row?.falseAnswers) ? row.falseAnswers : [])
        .slice(0, MAX_ANSWERS_PER_ROW)
        .map((fa: any) => ({ column: Number(fa?.column) || 0, value: str(fa?.value) })),
      maxPenalty: typeof row?.maxPenalty === 'number' ? row.maxPenalty : 0,
    }));
  // ...same treatment for timeScoreKey (10 rows) and merkScoreKey (6 rows)
  return { scoreKey, timeScoreKey, merkScoreKey };
}
```

Also replace the per-sheet `save()` loop in `app/api/stages/[id]/route.ts:93-99` with a
`bulkWrite`, so a stage update is one round-trip rather than N.

---

### [MEDIUM] Middleware matcher covers only `/api` — page routes rely on a client-side gate

**Location:** `middleware.ts:35-39` (`config.matcher`); `app/ClientLayout.tsx:50-71`
(`AuthenticatedApp`)

**Vulnerability Explanation:**

```ts
export const config = {
  matcher: ['/api/:path*'],
};
```

No page route is protected at the edge. Access control for the UI lives entirely in
`AuthenticatedApp`, which renders `<LoginForm>` instead of `children` when
`isAuthenticated` is false — a client-side check, defeated by disabling JavaScript, editing
React state in devtools, or setting `authenticated: true` in an intercepted
`/api/auth/check` response.

Today the practical impact is limited, and it is worth being precise about why: every page
under `app/rallies/**` carries `'use client'` and fetches its data from `/api/*` at runtime, so
the HTML served to an unauthenticated visitor contains no rally data, and the API calls behind
it return 401. The exposure is structural rather than immediate — the route *structure* is
enumerable, and the invariant is fragile.

That fragility is the real finding. The moment any page is converted to a Server Component
that queries the database directly — the natural way to write App Router code, and a
performance improvement someone will reasonably propose — that page will render real data for
anonymous visitors, because no middleware stands in front of it. Nothing in the codebase would
flag the regression.

**Exploit Scenario:**
A developer converts `app/rallies/[id]/page.tsx` to a Server Component and calls
`Stage.find({ rallyId })` directly, dropping the client fetch. The matcher still reads
`/api/:path*`. An anonymous visitor requests `/rallies/<id>` and receives fully server-rendered
HTML containing every stage's `scoreKey` — the complete answer key — with no session cookie at
all. The client-side `AuthenticatedApp` gate does not help: the data is already in the HTML
payload before React hydrates.

**Remediation:**
Protect pages at the edge, with an explicit allow-list for public paths:

```ts
// middleware.ts
export const config = {
  matcher: [
    /*
     * Match everything except Next.js internals, static assets, and the
     * login page. Auth API routes are allow-listed inside the middleware.
     */
    '/((?!_next/static|_next/image|favicon.ico|login|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
```

Combine with the redirect branch shown in CRITICAL-1: unauthenticated `/api/*` requests get a
401, unauthenticated page requests get a redirect to `/login`. That requires extracting the
login screen from `ClientLayout` into a real `app/login/page.tsx` route — worth doing anyway,
since the current design renders the login form at every URL rather than at a dedicated one.

Keep the client-side gate as a UX convenience, but treat it as cosmetic. The server check is
the control.

---

## LOW

### [LOW] Password compared with `===` (non-constant-time)

**Location:** `app/api/auth/login/route.ts:10`

**Vulnerability Explanation:** JavaScript's `===` on strings short-circuits at the first
differing byte, so comparison time correlates with the length of the matching prefix. In
principle this leaks the secret character by character.

In practice, exploiting this over a network against Node's scheduler requires enormous sample
counts and is largely theoretical here — and it is moot while the password is a public string
literal (CRITICAL-3). Fix it as part of that change rather than on its own.

**Exploit Scenario:** An attacker on the same host or a very low-latency network path submits
millions of candidate passwords, statistically averaging response times per leading character
to recover the secret incrementally without ever seeing a success response.

**Remediation:** Use `timingSafeEqual` over hashes of equal length — already incorporated in
the CRITICAL-3 remediation:

```ts
import { timingSafeEqual } from 'crypto';
const match = actual.length === expected.length && timingSafeEqual(actual, expected);
```

Hash-then-compare also normalizes length, so the comparison leaks nothing about the password's
length either.

---

### [LOW] Raw error message rendered in the error boundary

**Location:** `app/error.tsx:26`

**Vulnerability Explanation:** `{error.message || "An unexpected error occurred."}` renders
the message directly. React escapes the string, so this is not an XSS vector. The concern is
information disclosure: in development, and for any error thrown in client code, the message
may expose internal paths, database errors, or library internals.

Next.js redacts Server Component error messages in production builds — replacing them with a
generic string plus a `digest` — so the production exposure is genuinely small. Worth
tightening for defense in depth.

**Exploit Scenario:** An attacker triggers a client-side failure (a malformed API response, a
forced parse error) and reads a message revealing library versions or internal structure,
which informs further probing.

**Remediation:** Show a fixed message and surface the digest for correlation:

```tsx
<p className="mt-2 text-center text-sm text-gray-600">
  An unexpected error occurred. Please try again.
</p>
{error.digest && (
  <p className="mt-1 text-center text-xs text-gray-400">
    Reference: {error.digest}
  </p>
)}
```

Log the full error server-side, keyed by digest, rather than showing it to the user.

---

### [LOW] Database URI falls back silently to localhost

**Location:** `app/lib/mongodb.ts:3`

**Vulnerability Explanation:**

```ts
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/orc-points-system';
```

If `MONGODB_URI` is unset or misspelled in production, the application does not fail — it
quietly connects to a local MongoDB. Depending on what is listening on port 27017 in that
container or network namespace, this either produces a confusing empty-data state or writes
production data into an unintended, likely unauthenticated, database.

**Exploit Scenario:** A deployment ships with the env var missing. The app starts cleanly and
serves the login page, so the deploy looks healthy. Operators enter rally data that lands in a
throwaway local instance with no authentication and no backups — data loss, and potentially
data sitting in an unsecured store.

**Remediation:** Fail fast at module load:

```ts
import 'server-only';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error(
    'MONGODB_URI is not set. Configure it in the deployment environment.'
  );
}
```

Keep local development working via an untracked `.env.local` (see CRITICAL-2), not via a
hardcoded fallback.

---

## Verified protections

Categories reviewed where no vulnerability was found, and the specific protection observed:

**Cross-site scripting (XSS)**
- No `dangerouslySetInnerHTML` anywhere in the codebase.
- No `eval`, `new Function`, or dynamic `<script>` injection.
- All rendering goes through JSX interpolation, which React escapes by default.
- User-controlled strings (rally names, stage names, `merk`/`ipt`/`wpt` values) reach the DOM
  only as text children, never as attributes or markup.

**Open redirect**
- `router.push` is called in three places and every target is a hardcoded template literal
  over an internal path: `app/components/LoginForm.tsx:24` (`'/'`),
  `app/rallies/new/page.tsx:37`, `app/rallies/[id]/stages/new/page.tsx:48`, and
  `app/rallies/[id]/stages/[stageId]/edit/page.tsx:95`.
- No navigation target is derived from a query parameter, a `returnTo`/`next` value, a hash, or
  any other user-supplied input.
- Every `href` in the application is an internal path built from route params; none is
  attacker-controlled, and there are no `target="_blank"` links (so no `rel="noopener"` gap).

**Client/server boundary**
- No `NEXT_PUBLIC_*` variables exist. `process.env` is referenced exactly twice —
  `app/lib/mongodb.ts:3` and `app/api/auth/login/route.ts:18` — both in server-only code paths.
- No sensitive value is passed from a Server Component into a Client Component: every page
  under `app/rallies/**` is `'use client'` and fetches through the authenticated API, so no
  Mongoose document crosses the RSC serialization boundary.
- `app/lib/scoring.ts`, the one module genuinely shared between server and client, contains
  pure arithmetic and no secrets — correctly shared.

**Injection (beyond MEDIUM-2)**
- Every `[id]` route parameter is validated with `mongoose.Types.ObjectId.isValid()` before use:
  `app/api/rallies/[id]/route.ts:15,41,74`, `app/api/stages/[id]/route.ts:41,67,116`,
  `app/api/answersheets/[id]/route.ts:16,42,77`, and
  `app/api/rallies/[id]/standings/route.ts:18`.
- Query-string IDs are validated identically at `app/api/stages/route.ts:39` and
  `app/api/answersheets/route.ts:21,27`.
- Mongoose schema casting is in effect throughout; no `$where`, no `mapReduce`, no raw
  aggregation pipeline built from user input, and no string-concatenated queries.
- Standings aggregation (`app/api/rallies/[id]/standings/route.ts:36-49`) runs in application
  code over already-filtered documents rather than through a user-influenced pipeline.

**Cookie handling**
- `httpOnly: true` is set on the session cookie, so it is not readable from JavaScript —
  this is correct and limits XSS-based session theft.
- `path: '/'` is appropriate for an app-wide session.
- The session cookie is the only cookie the application sets.

**Server-side request forgery (SSRF)**
- No outbound HTTP requests are made from any route handler. All `fetch` calls are
  client-side and target same-origin relative paths (`/api/...`).

**Container hardening (`Dockerfile`)**
- Runs as a non-root user (`nextjs`, uid 1001) — `Dockerfile:26-27,40`.
- Multi-stage build; only `.next/standalone`, `.next/static`, and `public` reach the runtime
  image, so source and dev dependencies are not shipped.
- No secrets are baked in at build time — `MONGODB_URI` is supplied at runtime.
- `.dockerignore` is present.

**Dependencies**
- Next.js 15.3.1, React 19, Mongoose 8.14 — all current major versions at the time of review,
  with no known critical advisories against these specific versions. Run `npm audit` in CI to
  keep this true.

---

## Recommended remediation order

1. **CRITICAL-1** — sign and verify the session token. Nothing else matters until this is done;
   every other control is downstream of it.
2. **CRITICAL-2** — rotate the MongoDB password, move it to Coolify env vars, purge from git
   history. Rotation first: the credential is compromised regardless of how quickly the file
   is removed.
3. **CRITICAL-3** — move the app password to `APP_PASSWORD_HASH`, rotate it, scrub `COOLIFY.md`.
4. **HIGH-1, HIGH-2, HIGH-3** — rate limiting, server-side expiry, cookie flags. These ship
   naturally alongside the session rewrite in step 1.
5. **MEDIUM-1, MEDIUM-5** — security headers and the middleware matcher. Both are
   configuration-only changes with no application logic to rework.
6. **MEDIUM-2, MEDIUM-3, MEDIUM-4** — input validation, `server-only` guards, body limits.
7. **LOW-1/2/3** — fold into the changes above; LOW-1 is already covered by step 3.

Steps 1–3 are the difference between "publicly writable database" and "an internal tool with a
shared password." Steps 4 onward are the difference between that and a defensible deployment.


---

## Remediation status

Applied on branch `claude/nextjs-security-audit-gfojkw`. Verified against a running production
build (`next start`) with `curl` and a real Chromium session; see *Verification* below.

| # | Finding | Status | Where |
| --- | --- | --- | --- |
| CRITICAL-1 | Forgeable session token | **Fixed** | `app/lib/session.ts`, `middleware.ts`, `app/api/auth/check/route.ts` |
| CRITICAL-2 | Committed DB credentials | **Partly fixed** — code done, **rotation is yours** | `.gitignore`, `.env.example`, `COOLIFY.md` |
| CRITICAL-3 | Hardcoded app password | **Partly fixed** — code done, **rotation is yours** | `app/api/auth/login/route.ts`, `scripts/hash-password.mjs` |
| HIGH-1 | No rate limiting | **Fixed** | `app/lib/rate-limit.ts`, login route, `middleware.ts` |
| HIGH-2 | No server-side session expiry | **Fixed** | `app/lib/session.ts` |
| HIGH-3 | Insecure cookie configuration | **Fixed** | `app/api/auth/login/route.ts`, `middleware.ts` |
| MEDIUM-1 | Missing security headers | **Fixed, with one deviation** | `next.config.ts` |
| MEDIUM-2 | NoSQL operator injection | **Fixed** | `app/lib/validation.ts`, `app/lib/mongodb.ts` |
| MEDIUM-3 | Missing `server-only` guards | **Fixed** | `app/lib/*`, `app/models/index.ts`, all route handlers |
| MEDIUM-4 | Unbounded request bodies | **Fixed** | `app/lib/body.ts`, `app/lib/validation.ts` |
| MEDIUM-5 | Middleware matcher gap | **Fixed** | `middleware.ts`, `app/login/page.tsx`, `app/ClientLayout.tsx` |
| LOW-1 | Non-constant-time comparison | **Fixed** | `app/api/auth/login/route.ts` |
| LOW-2 | Error message reflection | **Fixed** | `app/error.tsx` |
| LOW-3 | Silent database fallback | **Fixed** | `app/lib/mongodb.ts`, `app/lib/env.ts` |

### Deviation from the proposed remediation: CSP without a nonce

MEDIUM-1 proposed a nonce-based `script-src`. It was implemented, tested in a browser, and
**reverted** — it broke the application outright.

A per-request nonce only works for dynamically rendered pages. Next.js prerenders `/`,
`/login`, `/rallies`, and `/rallies/new` at build time, so their HTML cannot carry a nonce
that matches a header minted per request. Chromium refused every inline script and every
chunk, React never hydrated, and the login form was inert.

The shipped policy uses `script-src 'self' 'unsafe-inline'` and keeps every other directive
strict — `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`, `object-src
'none'`, `default-src 'self'`, `connect-src 'self'`. Those are the directives carrying the real
weight for this app, which has no HTML-injection sink. Restoring the nonce requires
`export const dynamic = 'force-dynamic'` on the root layout, trading away static rendering;
the reasoning is recorded in a comment in `next.config.ts`.

### Still required from an operator

Three things cannot be fixed from the repository:

1. **Rotate the MongoDB password.** The committed credential is compromised. Removing the file
   does not un-leak it.
2. **Purge `.env.local` from git history**, coordinating with everyone holding a clone:
   `git filter-repo --path .env.local --invert-paths` then a force-with-lease push.
3. **Set the three new environment variables** in Coolify before deploying — `MONGODB_URI`,
   `SESSION_SECRET`, `APP_PASSWORD_HASH`. The app builds without them but fails fast with a
   clear error on the first request if any is missing. Use `scripts/generate-secret.mjs` and
   `scripts/hash-password.mjs`. Choose a **new** application password; the old one is public to
   everyone with repo access.

### Verification

Run against a production build with a valid session and, separately, with forged ones:

- The published exploit cookie `MS1hdXRoZW50aWNhdGVk` now returns **401** on every endpoint,
  including `DELETE /api/rallies/[id]`, and `/api/auth/check` reports `authenticated: false`.
- Tampered signature, truncated token, and garbage token: **401**.
- A correctly HMAC-signed but 25-hour-old token: **401** (expiry is enforced server-side, not
  by cookie `maxAge`). A future-dated token is also rejected.
- Unauthenticated `GET /rallies` **307**s to `/login`; unauthenticated API calls return **401**.
- Login sets `Secure; HttpOnly; SameSite=lax`.
- Login rate limit: attempts 1–5 return 401, attempt 6 returns **429** with `Retry-After: 900`.
  The correct password from the throttled IP still returns 429; a different IP is unaffected.
- Global API limit: 135 requests from one IP → 120 served, 15 rejected with **429**.
- Cross-origin `POST` (including the `text/plain` CSRF trick that bypasses preflight):
  **403**. Same-origin and proxy-style (`X-Forwarded-Host` + `https` Origin) requests pass.
- `eq: {"$gt": 0}`, `eq: "5"`, `eq: 999`, `name: {"$ne": null}`, a JSON array body, and
  malformed JSON all return **400**. `?eq=abc` returns 400 instead of the previous 500.
- A 400 KB body returns **413**.
- Browser (Chromium): unauthenticated → `/login` → login → `/` → client-side nav → logout →
  session cookie cleared → revisiting `/rallies` bounces to `/login`. **Zero CSP violations.**
- The exact payloads `StageForm` and `AnswerSheetForm` submit (30 answer rows, 10 time rows,
  6 merk rows, 4 columns) round-trip through validation byte-identical, so legitimate
  submissions are unaffected.

`tsc --noEmit`, `eslint`, and `next build` all pass. The build succeeds with **no** environment
variables present, matching how the Dockerfile builds the image.

### Behavior changes worth knowing

- The login screen moved from a conditional render on every route to its own `/login` route.
  `ClientLayout` no longer gates content — middleware does.
- `eq` must now be an integer. A decimal such as `5.5` was previously stored; it now returns
  400.
- Stage and rally names are capped at 200 characters; answer-key text fields at 64.
- If a session expires while a page is open, in-flight API calls return 401 and the page shows
  its error state. The next navigation redirects to `/login`. Auto-redirecting on a 401 from a
  background fetch was not added — it would touch every page's fetch logic and is outside the
  security scope.
