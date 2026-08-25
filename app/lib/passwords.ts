import 'server-only';

// scrypt password hashing, in the one format this app stores: "<saltHex>:<hashHex>".
//
// It is the format `scripts/hash-password.mjs` has always printed for
// APP_PASSWORD_HASH, so the break-glass credential in the environment and a
// user's password in the database are verified by the same code. Extracted out
// of the login route when accounts arrived: a second implementation would be a
// second chance to compare a hash with `===`.
//
// node:crypto, not Web Crypto: this module is only ever reached from a route
// handler on the Node runtime. `app/lib/session.ts` is the one that also runs on
// the Edge, and it deliberately stays on Web Crypto.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export function isPasswordHash(value: string): boolean {
  return /^[0-9a-f]+:[0-9a-f]+$/i.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_BYTES);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

// Compare a candidate password against a stored "<saltHex>:<hashHex>".
//
// Never throws on a malformed stored value: a broken hash reads as "wrong
// password", which is what the caller would do with the exception anyway.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  try {
    const salt = Buffer.from(saltHex, 'hex');
    const hash = Buffer.from(hashHex, 'hex');
    if (salt.length === 0 || hash.length === 0) return false;

    const derived = await scrypt(password, salt, hash.length);

    // Constant time. Comparing derived hashes rather than the plaintext also
    // means the comparison leaks nothing about the password's length.
    return derived.length === hash.length && timingSafeEqual(derived, hash);
  } catch {
    return false;
  }
}

// Work done on a login for a username that does not exist, so a wrong username
// and a wrong password take the same time. Without it the response time is a
// list of which accounts are real.
const DUMMY_HASH =
  '00000000000000000000000000000000:' + '0'.repeat(KEY_BYTES * 2);

export async function burnPasswordTime(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}
