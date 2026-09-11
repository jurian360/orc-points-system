// Signed session tokens.
//
// The token is `<payload>.<hmac>`, where `<payload>` is a base64url-encoded
// JSON claim set and the HMAC covers it using SESSION_SECRET. A client cannot
// mint or modify a token without the secret, and cannot backdate one because
// the timestamp is inside the signed payload.
//
// The claims name the account: which user this is and what role they had when
// they signed in. That is what lets middleware gate an admin-only page at the
// edge, where there is no database. It is *not* the last word on the role —
// `requireAdmin()` re-reads the user server-side, so a demoted account loses
// its admin pages on its next request rather than when its token expires.
//
// This module uses Web Crypto (not node:crypto) deliberately: middleware.ts
// runs on the Edge runtime, where node:crypto is unavailable. Web Crypto is
// available in both runtimes, so server and edge share one implementation and
// cannot drift apart.

import { requireEnv } from './env';
import { isRole, type Role } from './roles';

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// A token is a cookie, and a cookie that grows without bound is a header that
// gets dropped. The claims are four short fields; this is generous headroom.
const MAX_TOKEN_LENGTH = 1024;

// Cache the imported key per secret so we do not re-import on every request.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(): Promise<CryptoKey> {
  // 32 chars minimum — a short secret makes the signature forgeable by search.
  const secret = requireEnv('SESSION_SECRET', 32);

  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
      ),
    };
  }

  return cachedKey.key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const binary = atob(base64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function sign(payload: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(),
    new TextEncoder().encode(payload)
  );
  return toBase64Url(new Uint8Array(signature));
}

// The subject of the break-glass admin from the environment. It is not a
// database id on purpose: that account has no `User` document, so nothing can
// delete it or take its role away (see app/lib/users.ts).
export const ENV_ADMIN_SUBJECT = 'env';

// Which collection this session's `sub` is an id in.
//
//   * `official`   — a `User` document, or the break-glass admin from the
//                    environment. Signs in with a username.
//   * `participant`— a `Person` document (app/lib/persons.ts). Signs in with an
//                    e-mail address.
//
// It is a claim rather than something inferred from the role because it decides
// **which collection is read** when the session is re-checked, and a lookup
// that guesses is a lookup that can be pointed at the wrong table. A token
// minted before this claim existed has no `knd` and reads as `official`, which
// is what every session in the wild was.
export type SessionKind = 'official' | 'participant';

export function isSessionKind(value: unknown): value is SessionKind {
  return value === 'official' || value === 'participant';
}

export interface SessionUser {
  // The account's `_id` as a string — a `User` or a `Person` depending on
  // `kind` — or ENV_ADMIN_SUBJECT for the environment admin.
  sub: string;
  // The username of an official, or the e-mail address of a participant:
  // whatever this account signs in with and is shown as.
  username: string;
  kind: SessionKind;
  role: Role;
  // When the session was issued, in epoch milliseconds. `requireSession()`
  // compares it with the account's `passwordChangedAt`, so changing a password
  // signs the account's other sessions out.
  issuedAt: number;
}

export async function createSessionToken(user: {
  sub: string;
  username: string;
  kind: SessionKind;
  role: Role;
}): Promise<string> {
  // The nonce makes each session individually identifiable, which is what a
  // future revocation list would key on.
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const claims = {
    iat: Date.now(),
    nonce,
    sub: user.sub,
    usr: user.username,
    knd: user.kind,
    role: user.role,
  };

  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  return `${payload}.${await sign(payload)}`;
}

// Verify the signature and the expiry, and return who the token says this is.
// `null` means "no session" — malformed, forged, or expired are one answer to
// every caller.
export async function readSessionToken(
  token: string | undefined | null
): Promise<SessionUser | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = fromBase64Url(token.slice(separator + 1));
  if (!signature) return null;

  // crypto.subtle.verify compares in constant time.
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(),
      signature as unknown as ArrayBuffer,
      new TextEncoder().encode(payload)
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  // Only now is the payload worth parsing: it is proven to be ours.
  const decoded = fromBase64Url(payload);
  if (!decoded) return null;

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(decoded)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const { iat, sub, usr, knd, role } = claims;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  if (typeof sub !== 'string' || !sub) return null;
  if (typeof usr !== 'string' || !usr) return null;
  if (!isRole(role)) return null;

  // A token minted before the claim existed is an official's: that is what
  // every session there was. An unrecognisable value is not read charitably —
  // it is a forged or corrupted token, and those are `null` like any other.
  if (knd !== undefined && !isSessionKind(knd)) return null;
  const kind: SessionKind = isSessionKind(knd) ? knd : 'official';

  // A participant is a `Person` and an official is not, so the two halves of
  // the claim set have to agree. Refusing the mismatch here means no caller
  // downstream has to wonder whether a `participant` role on an `official`
  // session is a promotion or a demotion.
  if ((role === 'participant') !== (kind === 'participant')) return null;

  // Expiry is enforced here, server-side. The cookie's maxAge is only a hint to
  // the browser and says nothing about a replayed or exported cookie value.
  const age = Date.now() - iat;
  if (age < 0 || age >= MAX_AGE_MS) return null;

  return { sub, username: usr, kind, role, issuedAt: iat };
}

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_MS / 1000;

// The attributes every write of the session cookie uses. Login, logout and the
// re-issue after a password change all set the cookie; sharing the options is
// what keeps the browser replacing the cookie rather than keeping a
// differently-scoped second one.
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  // Unconditional: a misconfigured NODE_ENV must not downgrade the session
  // cookie onto plaintext HTTP. Browsers treat localhost as a secure context,
  // so local development still works.
  secure: true,
  // Blocks the cross-site form post that would otherwise reach these endpoints,
  // since request.json() ignores Content-Type.
  sameSite: 'lax',
  path: '/',
} as const;
