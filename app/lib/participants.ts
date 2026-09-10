// Participants of a rally: the crew riding under an EQ number.
//
// Scoring never looks at any of this — a participant still *is* their answer
// sheets, and an EQ without a record is simply an EQ nobody typed a name for.
// This only records who that EQ is and the class they ride in, so the standings
// read as crews rather than as bare numbers.
//
// Shared by the API and the React views on purpose: the class letters an
// official can pick from must be the same ones the API accepts.

// The classes a participant can ride in. Kept as bare letters — they are what
// is written on the entry list and on the card. `N` and `S` are Nickerie and
// Stad, where the crew rides.
export const CLASSIFICATIONS = ['B', 'A', 'H', 'I', 'T', 'N', 'S'] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

// `''` is a participant whose class has not been recorded (yet).
export type ClassificationValue = Classification | '';

export interface ParticipantDetails {
  eq: number;
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
}

export function isClassification(value: unknown): value is Classification {
  return typeof value === 'string' && (CLASSIFICATIONS as readonly string[]).includes(value);
}

// The classes in a sentence, for the message a rejected class answers with:
// "B, A, H, I, T, N or S". Derived rather than written out, because it was
// spelled out in four places and adding a class left all four of them lying.
export const CLASSIFICATION_LIST = CLASSIFICATIONS.join(', ').replace(
  /, ([^,]+)$/,
  ' or $1'
);

// The **wedstrijdklasse**: the classes that are ranked together as one
// competition. `A` and `H` ride the same rally against each other, so the
// results carry a combined ranking of the two next to their own class sheets.
//
// It is not a class a crew can be entered in — nothing is ever recorded as a
// wedstrijdklasse on the entry list, and `CLASSIFICATIONS` deliberately does
// not hold it. It is a way of *reading* the standings, which is why it only
// exists on the printed results.
export const WEDSTRIJDKLASSE_CLASSES: readonly Classification[] = ['A', 'H'];

export const WEDSTRIJDKLASSE_LABEL = 'Wedstrijdklasse';

// True for a crew that rides in the wedstrijdklasse. A crew without a recorded
// class is not in it — a gap in the entry list is not a class.
export function inWedstrijdklasse(value: ClassificationValue): boolean {
  return value !== '' && WEDSTRIJDKLASSE_CLASSES.includes(value);
}

// "Jan Jansen / Piet Peters", or just the name that is known. Empty when
// neither has been entered, so callers can fall back to the EQ number.
export function crewLabel(
  details?: { driverName?: string; navigatorName?: string } | null
): string {
  if (!details) return '';
  return [details.driverName, details.navigatorName]
    .map((name) => (name || '').trim())
    .filter(Boolean)
    .join(' / ');
}
