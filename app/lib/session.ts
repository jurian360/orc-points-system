// Signed session tokens.
//
// The token is `<issuedAt>.<nonce>.<hmac>`, where the HMAC covers
// `<issuedAt>.<nonce>` using SESSION_SECRET. A client cannot mint or modify a
// token without the secret, and cannot backdate one because the timestamp is
// inside the signed payload.
//
// This module uses Web Crypto (not node:crypto) deliberately: middleware.ts
// runs on the Edge runtime, where node:crypto is unavailable. Web Crypto is
// available in both runtimes, so server and edge share one implementation and
// cannot drift apart.

import { requireEnv } from './env';

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

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

export async function createSessionToken(): Promise<string> {
  // The nonce makes each session individually identifiable, which is what a
  // future revocation list would key on.
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${Date.now()}.${nonce}`;
  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token || token.length > 512) return false;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = fromBase64Url(token.slice(separator + 1));
  if (!signature) return false;

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
    return false;
  }
  if (!valid) return false;

  // Expiry is enforced here, server-side. The cookie's maxAge is only a hint to
  // the browser and says nothing about a replayed or exported cookie value.
  const issuedAt = Number(payload.slice(0, payload.indexOf('.')));
  if (!Number.isFinite(issuedAt)) return false;

  const age = Date.now() - issuedAt;
  return age >= 0 && age < MAX_AGE_MS;
}

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = MAX_AGE_MS / 1000;
