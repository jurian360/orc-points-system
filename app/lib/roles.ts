// The kinds of account this app knows, and what each of them may do.
//
// Pure and dependency-free on purpose: the API guards (`requirePermission`),
// the Edge middleware and the React views all read the same table, so what a
// button hides and what a route refuses cannot drift apart. Hiding a button is
// never the control — `app/lib/api-guard.ts` is — but the two should agree.
//
// Two kinds of people hold an account, and the difference runs deeper than the
// permissions below:
//
//   * **Officials** run the event. They are `User` documents and they sign in
//     with a username.
//   * **Participants** ride it. They are `Person` documents (app/lib/persons.ts)
//     and they sign in with their e-mail address. A participant sees their own
//     results and nothing else — which is why they hold no permission from this
//     table at all, and why every route they can reach is under `/api/me`.
//
// `isOfficialRole` below is what tells the two apart, and it is the reason a
// participant cannot be given a rally role by editing a request body.

export const ROLES = ['admin', 'data-entry', 'classification-admin', 'participant'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

// The roles an **official's account** can hold. `participant` is deliberately
// not one of them: a participant is a `Person`, not a `User`, so /api/users
// must refuse the role rather than create an account that authenticates
// against the wrong collection.
export const OFFICIAL_ROLES = ['admin', 'data-entry', 'classification-admin'] as const;

export type OfficialRole = (typeof OFFICIAL_ROLES)[number];

export function isOfficialRole(value: unknown): value is OfficialRole {
  return typeof value === 'string' && (OFFICIAL_ROLES as readonly string[]).includes(value);
}

// What each role is called on screen.
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  'data-entry': 'Data entry',
  'classification-admin': 'Classification admin',
  participant: 'Participant',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Runs the rally: keys, stages, the entry list, imports, QR codes, the riders and the users.',
  'data-entry': 'Types control cards (ORC, tijd and merk) and reads the standings.',
  'classification-admin':
    "Sets the riders' classifications and reads their results. No answer keys and no control cards.",
  participant: 'Rides the rally. Sees their own entries, crews and results.',
};

// The permissions, in the shape the app actually branches on.
//
//   manage:users           — add, edit and remove officials' accounts.
//   manage:rally           — everything that changes a rally: its name, code,
//                            date and whether it counts, its stages and their
//                            answer keys, the entry list, the time import, the
//                            QR codes and the on-demand re-score.
//   manage:persons         — the rider registry: add a person, correct their
//                            e-mail, contact details and login.
//   manage:classifications — set the class a rider rides in. Held by an admin
//                            and by a classification admin, and by nobody else:
//                            it moves a crew between the overall standings.
//   enter:sheets           — type, correct and delete a participant's answer
//                            sheet.
//   view:results           — read rallies, cards, standings and the riders'
//                            results.
//   view:keys              — read a stage's **answer key**: the correct letters,
//                            the timetable and the merk key. Split out of
//                            `view:results` when the classification admin
//                            arrived — that role reads results and must not see
//                            the keys, and a role that cannot see a key has no
//                            business typing a card against it either.
//
// `manage:rally` deliberately covers the whole of a rally's setup rather than
// splitting per route: a data-entry user who could edit a key could rewrite the
// score of every card typed against it.
export const PERMISSIONS = [
  'manage:users',
  'manage:rally',
  'manage:persons',
  'manage:classifications',
  'enter:sheets',
  'view:results',
  'view:keys',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  'data-entry': ['enter:sheets', 'view:results', 'view:keys'],
  // Reads the results, sets the classes, and touches nothing else. Notably
  // absent: `view:keys` and `enter:sheets` — this official may not see an
  // answer key or type a card against one.
  'classification-admin': ['manage:classifications', 'view:results'],
  // Empty on purpose. A participant reaches their own results through
  // `/api/me/*`, which authorises on *being* that person rather than on holding
  // a permission over everybody's data. Giving them `view:results` here would
  // hand them the whole field's standings and every rally's entry list.
  participant: [],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role || !isRole(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

// True for an account that is an official at all. The pages and the API routes
// of the rally are closed to everybody else, so this is the one check that
// keeps a participant's session out of the officials' half of the app without
// naming a permission — a role with no permissions would otherwise sail past
// every route whose guard is only `requireSession()`.
export function isOfficial(role: Role | null | undefined): boolean {
  return isOfficialRole(role);
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
