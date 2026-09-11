// The two kinds of account this app knows, and what each of them may do.
//
// Pure and dependency-free on purpose: the API guards (`requireAdmin`), the
// Edge middleware and the React views all read the same table, so what a button
// hides and what a route refuses cannot drift apart. Hiding a button is never
// the control — `app/lib/api-guard.ts` is — but the two should agree.
//
// There are exactly two roles and no plan for a third: officials either run the
// rally or they type cards for it.

export const ROLES = ['admin', 'data-entry'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// What each role is called on screen.
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  'data-entry': 'Data entry',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Runs the rally: keys, stages, the entry list, imports, QR codes and the users.',
  'data-entry': 'Types control cards (ORC, tijd and merk) and reads the standings.',
};

// The permissions, in the shape the app actually branches on.
//
//   manage:users     — add, edit and remove accounts.
//   manage:rally     — everything that changes a rally: its name and code, its
//                      stages and their answer keys, the entry list, the time
//                      import, the QR codes and the on-demand re-score.
//   enter:sheets     — type, correct and delete a participant's answer sheet.
//   view:results     — read rallies, stages, keys, cards and standings.
//
// `manage:rally` deliberately covers the whole of a rally's setup rather than
// splitting per route: a data-entry user who could edit a key could rewrite the
// score of every card typed against it.
export const PERMISSIONS = ['manage:users', 'manage:rally', 'enter:sheets', 'view:results'] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  'data-entry': ['enter:sheets', 'view:results'],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role || !isRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

// Password rules, shared by the browser-side forms and the API validators so a
// password the form accepts is never refused by the server.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 32;

// Usernames are lower-case and free of anything that would make two accounts
// look alike. Normalising here (rather than only validating) means "Jurian" and
// "jurian" are one account, so the unique index means what it says.
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return (
    value.length >= MIN_USERNAME_LENGTH &&
    value.length <= MAX_USERNAME_LENGTH &&
    /^[a-z0-9][a-z0-9._-]*$/.test(value)
  );
}

export const USERNAME_RULE =
  'Use 3-32 characters: lower-case letters, digits, dot, dash or underscore.';

export const PASSWORD_RULE = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

// An account's email, used for exactly one thing: receiving a forgot-password
// link (app/lib/passwordReset.ts). Optional — an account added before this
// existed has none until somebody fills it in — but unique when set, so a
// reset request resolves to one account.
export const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Deliberately loose: this only has to catch typos before an email is stored,
// not validate against the RFC. Postmark's own delivery is the real check.
export function isValidEmail(value: string): boolean {
  return value.length > 0 && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

// Stored and looked up already normalised, the same reason normalizeUsername
// exists: two accounts must not be able to look distinct while answering to
// the same mailbox.
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const EMAIL_RULE = 'Enter a valid email address.';
