// The short public identifier of a rally.
//
// A rally code is what a crew reads off the printed sheet and what the Android
// app shows as the name of the card in its list — and it is what a finalised
// card is sent back with, so it is also how a submission finds its way home
// (app/lib/appCards.ts).
//
// Officials name it themselves when they create the rally; the suggestion they
// start from is derived from the rally name here. This module is pure and
// deliberately free of `server-only`: the create form derives the same
// suggestion in the browser, so the two cannot disagree.

export const RALLY_CODE_MAX_LENGTH = 32;

// Upper-case letters and digits, optional dashes after the first character. No
// spaces: the code is read aloud and typed, not written in prose.
const RALLY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,31}$/;

// The code suggested for a rally called `name`: its letters and digits, upper
// case, trimmed to something short enough to print under a QR code.
export function slugFromName(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 10);
  return slug || 'RALLY';
}

// What a code field should hold while an official is still typing in it: their
// keystrokes, minus the characters a code cannot contain. Not a validator —
// it never rejects, so the field does not fight the person filling it in.
export function normalizeRallyCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '')
    .slice(0, RALLY_CODE_MAX_LENGTH);
}

// A rally code as it arrives from a form or from the app. Returns null for
// anything that is not a usable code, so it is never interpolated into a query
// unchecked.
export function parseRallyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return RALLY_CODE_PATTERN.test(normalized) ? normalized : null;
}
