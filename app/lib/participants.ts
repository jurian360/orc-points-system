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

// The **main** classes, and the only ones that stand in an order: `B < A < H`.
// A crew's class is the higher of its two members' (below), which is a question
// that only has an answer for these three.
//
// The other letters are not a step on this ladder. `I` and `T` are their own
// classes and `N` / `S` say *where* a crew rides (Nickerie, Stad), so ranking
// them against `H` would invent a judgement the sport does not make. They are
// deliberately absent from this table rather than given a rank of 0, so
// `classificationRank` returns null for them and the callers below have to say
// what they do about it.
const CLASSIFICATION_RANKS: Partial<Record<Classification, number>> = {
  B: 1,
  A: 2,
  H: 3,
};

// The main classes in order, lowest first. What the overall standings group on.
export const MAIN_CLASSIFICATIONS: readonly Classification[] = ['B', 'A', 'H'];

// Where a class sits on the `B < A < H` ladder, or null for a class that is not
// on it (and for a crew member whose class has not been recorded).
export function classificationRank(value: ClassificationValue): number | null {
  if (value === '') return null;
  return CLASSIFICATION_RANKS[value] ?? null;
}

// True for one of the three classes a crew is ranked in.
export function isMainClassification(value: ClassificationValue): boolean {
  return classificationRank(value) !== null;
}

// The class a **crew** rides in: the highest of the driver's and the
// navigator's, on `B < A < H`. Pairing a B with an H puts the car in H — the
// crew is as strong as its stronger half, which is the whole reason this is
// recorded per person and derived per crew rather than typed per entry.
//
// Only the main classes are ranked, so a pair holding `I`, `T`, `N` or `S`
// cannot be compared: the driver's class is then taken, falling back to the
// navigator's when the driver has none. That crew is simply not in the running
// for an overall standing, which reads the main classes.
export function crewClassification(
  driver: ClassificationValue,
  navigator: ClassificationValue
): ClassificationValue {
  const driverRank = classificationRank(driver);
  const navigatorRank = classificationRank(navigator);

  if (driverRank !== null && navigatorRank !== null) {
    return driverRank >= navigatorRank ? driver : navigator;
  }
  if (driverRank !== null) return driver;
  if (navigatorRank !== null) return navigator;

  return driver || navigator;
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
// results carry a combined ranking of the two next to their own class sheets
// — and the season's overall standings rank them together too, rather than as
// two separate classes, because a crew can be promoted or demoted between
// them mid-season (`wedstrijdklasseStandings` in `app/lib/overallStandings.ts`).
//
// It is not a class a crew can be entered in — nothing is ever recorded as a
// wedstrijdklasse on the entry list, and `CLASSIFICATIONS` deliberately does
// not hold it. It is a way of *reading* the standings, never of storing one.
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
