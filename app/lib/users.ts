import 'server-only';

// Accounts: the break-glass admin from the environment, and the lookups the
// guards and the user routes share.
//
// Two kinds of admin exist, deliberately:
//
//  * `User` documents — the accounts officials add, edit and delete on /users.
//  * One account from the environment (ADMIN_USERNAME + ADMIN_PASSWORD_HASH) —
//    the way back in when every admin has forgotten their password. It has no
//    document, so nothing in the app can delete it, demote it or lock it out,
//    and it survives the database being restored from a backup.
//
// The environment account's password is stored hashed, exactly like a user's:
// `node scripts/hash-password.mjs 'password'` prints the value to paste into
// Coolify. APP_PASSWORD_HASH — the single shared password this app had before
// accounts existed — is still accepted as that credential, so an existing
// deployment keeps working after this ships and can move to ADMIN_* at leisure.

import mongoose from 'mongoose';

import dbConnect from './mongodb';
import { User } from '../models';
import { ENV_ADMIN_SUBJECT, type SessionUser } from './session';
import { normalizeUsername, type Role } from './roles';
import { verifyPassword } from './passwords';

const DEFAULT_ENV_ADMIN_USERNAME = 'admin';

export interface EnvAdmin {
  username: string;
  passwordHash: string;
}

// The break-glass account, or null when the environment configures none.
//
// Read on each call rather than cached at module scope: `requireEnv`'s contract
// is that secrets are read lazily so `next build` runs without them.
export function envAdmin(): EnvAdmin | null {
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || process.env.APP_PASSWORD_HASH;
  if (!passwordHash) return null;

  const username = normalizeUsername(
    process.env.ADMIN_USERNAME || DEFAULT_ENV_ADMIN_USERNAME
  );

  return { username, passwordHash };
}

// Is this username the environment admin's? Used to keep a `User` document from
// shadowing it: two accounts answering to one username would make a login
// ambiguous, and the one that lost would be the one that cannot be repaired.
export function isEnvAdminUsername(username: string): boolean {
  const admin = envAdmin();
  return admin !== null && admin.username === normalizeUsername(username);
}

// The stored shape of a `User`, for the two `.lean()` reads below. The models
// are plain Mongoose schemas with no generated types, so the documents arrive
// untyped; naming the fields here is what keeps the rest of this module honest.
interface StoredUser {
  _id: unknown;
  username: string;
  email?: string | null;
  role: Role;
  passwordHash: string;
  passwordChangedAt?: Date | string | null;
}

// Which unique field a duplicate-key error (Mongo code 11000) tripped over, so
// a route can tell "that username is taken" apart from "that email is taken"
// instead of one generic message for both.
export function duplicateAccountField(error: unknown): 'username' | 'email' | null {
  if (typeof error !== 'object' || error === null) return null;
  const err = error as { code?: number; keyPattern?: Record<string, unknown> };
  if (err.code !== 11000 || !err.keyPattern) return null;
  if ('email' in err.keyPattern) return 'email';
  if ('username' in err.keyPattern) return 'username';
  return null;
}

export interface AuthenticatedUser {
  sub: string;
  username: string;
  role: Role;
  // '' for the environment admin, which has no document to hold one.
  email: string;
}

// Check a username and password against the environment admin and then the
// database. Returns null for "no such account or wrong password" — the caller
// must not tell the two apart.
//
// `ip` is optional only because the environment admin's branch never reaches
// the write below; every real caller (the login route) has one from
// `clientIp()`. On a successful database login it is stored as this account's
// `lastLoginIp`, so an admin can see who last signed in and from where.
export async function authenticate(
  username: string,
  password: string,
  ip?: string
): Promise<AuthenticatedUser | null> {
  const normalized = normalizeUsername(username);

  const admin = envAdmin();
  if (admin && admin.username === normalized) {
    if (await verifyPassword(password, admin.passwordHash)) {
      return { sub: ENV_ADMIN_SUBJECT, username: admin.username, role: 'admin', email: '' };
    }
    return null;
  }

  // Connect only now: the environment admin is checked above, so the way back
  // in still works while the database is unreachable.
  await dbConnect();

  // A real document, not `.lean()`, because a successful login writes the
  // last-login fields back onto it.
  const user = await User.findOne({ username: normalized });
  if (!user) return null;

  if (!(await verifyPassword(password, user.passwordHash))) return null;

  user.lastLoginAt = new Date();
  user.lastLoginIp = ip ? ip.slice(0, 64) : null;
  await user.save();

  return {
    sub: String(user._id),
    username: user.username,
    role: user.role,
    email: user.email ?? '',
  };
}

// Re-read the account a session claims to be, so a role change or a deletion
// takes effect on the next request instead of when the token expires.
//
// `null` means the session is no longer valid: the user is gone, or their
// password was changed after the token was issued (which is how a password
// change signs the account's other sessions out).
export async function currentUser(session: SessionUser): Promise<AuthenticatedUser | null> {
  // The environment admin has no document to re-read. Its credential lives in
  // the environment, so a session for it is as fresh as the deployment is.
  if (session.sub === ENV_ADMIN_SUBJECT) {
    const admin = envAdmin();
    if (!admin || admin.username !== session.username) return null;
    return { sub: ENV_ADMIN_SUBJECT, username: admin.username, role: 'admin', email: '' };
  }

  if (!mongoose.Types.ObjectId.isValid(session.sub)) return null;

  await dbConnect();

  const user = (await User.findById(session.sub).lean()) as StoredUser | null;
  if (!user) return null;

  const changedAt = user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0;
  // One second of slack: the token's `iat` and the document's timestamp are
  // written milliseconds apart by the same request when a user changes their
  // own password, and that session must survive its own change.
  if (changedAt - 1000 > session.issuedAt) return null;

  return {
    sub: String(user._id),
    username: user.username,
    role: user.role,
    email: user.email ?? '',
  };
}

// How many admin accounts exist in the database. The user routes refuse the
// edit that would take the last one away, so the app cannot be left with no
// way in but the environment.
export async function adminCount(): Promise<number> {
  await dbConnect();
  return User.countDocuments({ role: 'admin' });
}
