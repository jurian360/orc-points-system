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
import { Person, User } from '../models';
import { ENV_ADMIN_SUBJECT, type SessionKind, type SessionUser } from './session';
import { normalizeUsername, type Role } from './roles';
import { isValidEmail, normalizeEmail } from './persons';
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
  role: Role;
  passwordHash: string;
  passwordChangedAt?: Date | string | null;
}

// The stored shape of a `Person` for the two reads below. A rider with no
// `passwordHash` has no login, which is most of the entry list.
interface StoredPerson {
  _id: unknown;
  email: string;
  name: string;
  passwordHash?: string | null;
  passwordChangedAt?: Date | string | null;
}

export interface AuthenticatedUser {
  sub: string;
  username: string;
  // Which collection `sub` is an id in. Every caller that reads rider-owned
  // data branches on this rather than on the role, because it is the claim
  // that says *what* the id is.
  kind: SessionKind;
  role: Role;
}

// Check a credential against the environment admin, then the officials, then
// the riders. Returns null for "no such account or wrong password" — the caller
// must not tell the two apart.
//
// **What was typed decides which collection is searched.** An address with an
// `@` in it can only be a rider's; anything else can only be an official's
// username. So the two logins are one form and one endpoint without either
// being able to shadow the other: a username cannot contain `@`
// (`isValidUsername`), and an e-mail address must.
export async function authenticate(
  identifier: string,
  password: string
): Promise<AuthenticatedUser | null> {
  const email = normalizeEmail(identifier);

  if (isValidEmail(email)) {
    await dbConnect();

    const person = (await Person.findOne({ email }).lean()) as StoredPerson | null;
    // A rider with no password has no login. Not a different answer from a
    // wrong one: whether an address is on the entry list is not something a
    // login form should tell anybody.
    if (!person || !person.passwordHash) return null;

    if (!(await verifyPassword(password, person.passwordHash))) return null;

    return {
      sub: String(person._id),
      username: person.email,
      kind: 'participant',
      role: 'participant',
    };
  }

  const normalized = normalizeUsername(identifier);

  const admin = envAdmin();
  if (admin && admin.username === normalized) {
    if (await verifyPassword(password, admin.passwordHash)) {
      return {
        sub: ENV_ADMIN_SUBJECT,
        username: admin.username,
        kind: 'official',
        role: 'admin',
      };
    }
    return null;
  }

  // Connect only now: the environment admin is checked above, so the way back
  // in still works while the database is unreachable.
  await dbConnect();

  const user = (await User.findOne({ username: normalized }).lean()) as StoredUser | null;
  if (!user) return null;

  if (!(await verifyPassword(password, user.passwordHash))) return null;

  return {
    sub: String(user._id),
    username: user.username,
    kind: 'official',
    role: user.role,
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
    // Only an official's session can be the environment admin's. A token that
    // claims otherwise is forged or corrupt.
    if (session.kind !== 'official') return null;
    const admin = envAdmin();
    if (!admin || admin.username !== session.username) return null;
    return {
      sub: ENV_ADMIN_SUBJECT,
      username: admin.username,
      kind: 'official',
      role: 'admin',
    };
  }

  if (!mongoose.Types.ObjectId.isValid(session.sub)) return null;

  await dbConnect();

  // The `kind` claim decides which collection is read. It is not guessed from
  // the role: the id in `sub` belongs to one collection, and asking the other
  // one for it is how a lookup ends up pointed at the wrong table.
  if (session.kind === 'participant') {
    const person = (await Person.findById(session.sub).lean()) as StoredPerson | null;
    if (!person) return null;

    // A rider whose login was taken away — an admin cleared their password —
    // is signed out on their next request, exactly like a deleted official.
    if (!person.passwordHash) return null;

    if (passwordChangedSince(person.passwordChangedAt, session.issuedAt)) return null;

    return {
      sub: String(person._id),
      username: person.email,
      kind: 'participant',
      role: 'participant',
    };
  }

  const user = (await User.findById(session.sub).lean()) as StoredUser | null;
  if (!user) return null;

  if (passwordChangedSince(user.passwordChangedAt, session.issuedAt)) return null;

  return {
    sub: String(user._id),
    username: user.username,
    kind: 'official',
    role: user.role,
  };
}

// Was the account's password set after this token was issued? That is how a
// password change signs the account's *other* sessions out.
//
// One second of slack: the token's `iat` and the document's timestamp are
// written milliseconds apart by the same request when somebody changes their
// own password, and that session must survive its own change.
function passwordChangedSince(
  passwordChangedAt: Date | string | null | undefined,
  issuedAt: number
): boolean {
  const changedAt = passwordChangedAt ? new Date(passwordChangedAt).getTime() : 0;
  return changedAt - 1000 > issuedAt;
}

// The rider behind a participant's session, or null when the session is not a
// participant's. The `/api/me` routes are authorised by *being* this person, so
// this is the one place that turns a session into a `Person` id.
export function sessionPersonId(user: AuthenticatedUser): string | null {
  return user.kind === 'participant' ? user.sub : null;
}

// How many admin accounts exist in the database. The user routes refuse the
// edit that would take the last one away, so the app cannot be left with no
// way in but the environment.
export async function adminCount(): Promise<number> {
  await dbConnect();
  return User.countDocuments({ role: 'admin' });
}
