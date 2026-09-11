import 'server-only';

// The credential behind a forgot-password link.
//
// A token is high-entropy on its own, so it is never stored raw: only its hash
// goes in the database, the same reasoning app/lib/passwords.ts applies to an
// account's password. A leaked database then holds nothing a visitor could
// replay into a reset — recomputing the hash needs the token, which only ever
// existed in the email Postmark sent.
//
// node:crypto, not Web Crypto: like app/lib/passwords.ts, this is only ever
// reached from a route handler on the Node runtime.

import { createHash, randomBytes } from 'crypto';

export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_HEX_LENGTH = RESET_TOKEN_BYTES * 2;

// One hour: long enough that an email delivered a few minutes late still
// works, short enough that a link sitting unread in an inbox stops being a
// standing credential.
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function generateResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString('hex');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
