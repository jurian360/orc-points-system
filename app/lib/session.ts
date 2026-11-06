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
// This module uses Web Crypto (not node:crypto) deliberately: proxy.ts
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

export interface SessionUser {
  // The user's `_id` as a string, or ENV_ADMIN_SUBJECT for the environment admin.
  sub: string;
  username: string;
  role: Role;
  // When the session was issued, in epoch milliseconds. `requireSession()`
  // compares it with the user's `passwordChangedAt`, so changing a password
  // signs the account's other sessions out.
  issuedAt: number;
  // Only on the environment admin's session: a fingerprint of the password
  // hash it signed in with (see `envAdminCredential` in app/lib/users.ts). The
  // recovery admin has no `passwordChangedAt` to compare `issuedAt` with, so
  // this is what makes replacing ADMIN_PASSWORD_HASH sign its sessions out.
  credential?: string;
}

// A fingerprint is 32 hex characters; anything else in the claim is not ours.
const CREDENTIAL_PATTERN = /^[0-9a-f]{32}$/;

export async function createSessionToken(user: {
  sub: string;
  username: string;
  role: Role;
  credential?: string;
}): Promise<string> {
  // The nonce makes each session individually identifiable, which is what a
  // future revocation list would key on.
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const claims = {
    iat: Date.now(),
    nonce,
    sub: user.sub,
    usr: user.username,
    role: user.role,
    ...(user.credential ? { cred: user.credential } : {}),
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

  const { iat, sub, usr, role, cred } = claims;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  if (typeof sub !== 'string' || !sub) return null;
  if (typeof usr !== 'string' || !usr) return null;
  if (!isRole(role)) return null;
  if (cred !== undefined && (typeof cred !== 'string' || !CREDENTIAL_PATTERN.test(cred))) {
    return null;
  }

  // Expiry is enforced here, server-side. The cookie's maxAge is only a hint to
  // the browser and says nothing about a replayed or exported cookie value.
  const age = Date.now() - iat;
  if (age < 0 || age >= MAX_AGE_MS) return null;

  return {
    sub,
    username: usr,
    role,
    issuedAt: iat,
    ...(typeof cred === 'string' ? { credential: cred } : {}),
  };
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
