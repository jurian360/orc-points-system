// A **season**: one rally year, and the rules that decide how it is won.
//
// The club rides about ten rallies a year. Some of them are unofficial — a
// training run, a rit that did not make the calendar — and those are ridden
// and scored exactly like any other but do not count towards the year
// (`Rally.countsForSeason`). What is left is the season.
//
// **A season is not scored the way a rally is, and this is the one place in
// the app where a point is a reward.** Inside a rally the lowest strafpunten
// win: points are a penalty and nothing ever subtracts. A season is a
// championship table laid over those results — a crew's *finish position* in
// each rally earns championship points from the table below, weighted by how
// much that rally was worth, and the **highest** total wins the year.
//
// Keeping the two apart is deliberate. A rally's strafpunten cannot be summed
// across a season anyway: the historical rallies the club has on paper record
// a finishing order and no points at all, and a table that mixed the two
// currencies would be meaningless. A position is the one thing every rally
// has, whether it was scored here or ridden before this app existed.
//
// Pure and shared, client + server: the overall standings are computed on the
// server and the settings form previews the effect of a change in the browser.

// The year a rally belongs to: the calendar year it was ridden in. A rally is
// dated, not seasoned — the club has never run a season across a new year, and
// a separate `season` field would be a second answer to a question the date
// already answers.
export function rallyYear(date: Date | string): number {
  return new Date(date).getFullYear();
}

// How many official rallies a crew has to have ridden together before they are
// placed in the overall standings at all. Three, in the club's rules: an
// overall standing is for the crews who rode the season, not for a pair who
// turned up once and won.
export const DEFAULT_MINIMUM_RALLIES = 3;

// How many of a crew's results are added up. `0` is "all of them" and is the
// default. Setting it to 3 counts each crew's three **best** rallies, which is
// what a season with a long calendar usually does — riding a fourth can then
// only help, never hurt.
export const ALL_RESULTS = 0;

export const MAX_COUNTING_RESULTS = 50;

// --- The points table -------------------------------------------------------

// What a **band** of finish positions is worth. The club's table is written in
// bands rather than place by place — the first five places each score their
// own number, and from sixth down they are grouped in twos and then threes —
// so that is how it is stored. Expanding it into eighty-five rows would store
// the same table in a shape nobody wrote it in and make the editor eighty-five
// boxes long.
//
// `from` and `to` are inclusive, and `from === to` is a band of one place.
export interface PointsBand {
  from: number;
  to: number;
  points: number;
}

// How far down the field a table may reach, how many bands it may have, and
// how much one place may be worth. Bounds rather than rules: they keep a
// malformed table from making the editor and the standings arbitrarily large.
export const MAX_TABLE_POSITIONS = 500;
export const MAX_TABLE_BANDS = 200;
export const MAX_POSITION_POINTS = 10000;

// The club's points table: what each finishing place is worth before the
// rally's time factor multiplies it.
//
// A year that has not been configured is read with this. A year an official
// has saved a table for uses theirs — which is what `Season.pointsTable` is
// for, and why the table is editable per season rather than only living here:
// a scale that changes in 2028 must not restate 2026.
export const DEFAULT_POINTS_TABLE: PointsBand[] = [
  { from: 1, to: 1, points: 100 },
  { from: 2, to: 2, points: 90 },
  { from: 3, to: 3, points: 83 },
  { from: 4, to: 4, points: 78 },
  { from: 5, to: 5, points: 74 },
  { from: 6, to: 7, points: 68 },
  { from: 8, to: 9, points: 62 },
  { from: 10, to: 11, points: 58 },
  { from: 12, to: 13, points: 54 },
  { from: 14, to: 15, points: 50 },
  { from: 16, to: 18, points: 44 },
  { from: 19, to: 21, points: 40 },
  { from: 22, to: 24, points: 36 },
  { from: 25, to: 27, points: 32 },
  { from: 28, to: 30, points: 28 },
  { from: 31, to: 33, points: 25 },
  { from: 34, to: 36, points: 23 },
  { from: 37, to: 39, points: 21 },
  { from: 40, to: 42, points: 20 },
  { from: 43, to: 45, points: 19 },
  { from: 46, to: 48, points: 18 },
  { from: 49, to: 51, points: 15 },
  { from: 52, to: 54, points: 14 },
  { from: 55, to: 57, points: 13 },
  { from: 58, to: 60, points: 12 },
  { from: 61, to: 63, points: 10 },
  { from: 64, to: 66, points: 9 },
  { from: 67, to: 69, points: 8 },
  { from: 70, to: 72, points: 6 },
  { from: 73, to: 75, points: 5 },
  { from: 76, to: 78, points: 4 },
  { from: 79, to: 81, points: 3 },
  { from: 82, to: 84, points: 2 },
  { from: 85, to: 85, points: 1 },
];

// What a crew earns for finishing `position`th.
//
// `0` means no place at all — a DNF or a DNS — and earns nothing: the table is
// a reward for finishing, and a crew who did not finish did not. So does a
// position past the end of the table: the club's scale stops at 85th, and
// anybody behind that scores nothing.
export function pointsForPosition(
  position: number,
  table: readonly PointsBand[]
): number {
  if (!Number.isInteger(position) || position < 1) return 0;
  return table.find((band) => position >= band.from && position <= band.to)?.points ?? 0;
}

// The table in ascending order, which is the only order it is ever read or
// shown in. Sorted here rather than trusted from the database, so a band
// inserted by hand cannot make the editor list places out of order.
export function sortPointsTable(table: readonly PointsBand[]): PointsBand[] {
  return [...table].sort((a, b) => a.from - b.from);
}

// The band as it is written on the club's sheet: "6 - 7", or just "5".
export function bandLabel(band: PointsBand): string {
  return band.from === band.to ? String(band.from) : `${band.from} - ${band.to}`;
}

// The last place that scores anything at all.
export function lastScoringPosition(table: readonly PointsBand[]): number {
  return table.reduce((last, band) => Math.max(last, band.to), 0);
}

// --- Settings ---------------------------------------------------------------

export interface SeasonSettings {
  year: number;
  // The **highest** `countingResults` scores of a crew are added up. 0 counts
  // every rally they rode.
  countingResults: number;
  minimumRallies: number;
  // What each band of finish positions is worth. Empty in the database means
  // the year has never been configured and is being read with
  // `DEFAULT_POINTS_TABLE`.
  pointsTable: PointsBand[];
  // True when `pointsTable` is the club's standard table above rather than one
  // saved for this year. Derived, never stored — the standings page says so,
  // so a reader knows whether the scale they are looking at was chosen for
  // this season or inherited.
  usingDefaultPointsTable: boolean;
}

// A season nobody has configured. Every year exists — there is no "create a
// season" step, because a rally with a date in it *is* the season starting —
// so this is what a year answers with until an official changes it.
export function defaultSeasonSettings(year: number): SeasonSettings {
  return {
    year,
    countingResults: ALL_RESULTS,
    minimumRallies: DEFAULT_MINIMUM_RALLIES,
    pointsTable: DEFAULT_POINTS_TABLE,
    usingDefaultPointsTable: true,
  };
}

// The counting rule in a sentence, for the heading above the standings. It is
// what a reader has to know to understand the numbers in front of them, so it
// is printed rather than left to a settings page they would have to go and
// open.
export function countingRuleLabel(settings: SeasonSettings): string {
  const minimum = `at least ${settings.minimumRallies} official ${
    settings.minimumRallies === 1 ? 'rally' : 'rallies'
  } with the same partner`;

  const counting =
    settings.countingResults === ALL_RESULTS
      ? 'Every official rally counts'
      : `The best ${settings.countingResults} result${
          settings.countingResults === 1 ? '' : 's'
        } of each crew count`;

  return (
    `${counting}; a crew needs ${minimum}. ` +
    'Each rally awards points for the finish position, multiplied by that ' +
    "rally's time factor — the highest season total wins."
  );
}

// True when the settings are usable. A season that counts fewer results than it
// demands rallies is not wrong — "ride 3, best 2 count" is a real rule — but a
// zero or negative minimum would place a crew who rode nothing.
export function isValidSeasonSettings(settings: {
  countingResults: number;
  minimumRallies: number;
}): boolean {
  return (
    Number.isInteger(settings.minimumRallies) &&
    settings.minimumRallies >= 1 &&
    settings.minimumRallies <= MAX_COUNTING_RESULTS &&
    Number.isInteger(settings.countingResults) &&
    settings.countingResults >= 0 &&
    settings.countingResults <= MAX_COUNTING_RESULTS
  );
}

// Is this a table the standings can be ranked on?
//
// Bands have to be whole, positive, the right way round and — the one that
// matters — **non-overlapping**: two bands covering position 3 would make
// third place worth whichever of them happened to be stored first. Gaps are
// allowed, because a scale that skips a range is a scale that awards nothing
// there, and the club's own table does exactly that below 85th.
export function isValidPointsTable(table: readonly PointsBand[]): boolean {
  if (table.length === 0 || table.length > MAX_TABLE_BANDS) return false;

  const sorted = sortPointsTable(table);
  let previousTo = 0;

  for (const band of sorted) {
    if (!Number.isInteger(band.from) || !Number.isInteger(band.to)) return false;
    if (band.from < 1 || band.to < band.from) return false;
    if (band.to > MAX_TABLE_POSITIONS) return false;
    // Sorted by `from`, so the only way to overlap is to start inside the one
    // before.
    if (band.from <= previousTo) return false;
    previousTo = band.to;

    if (typeof band.points !== 'number' || !Number.isFinite(band.points)) return false;
    if (band.points < 0 || band.points > MAX_POSITION_POINTS) return false;
  }

  return true;
}

// --- The time factor --------------------------------------------------------

// How much one rally is worth relative to the others. A long, hard event
// counts for more than a short one, and the club sets the number per rally.
// `1` is an ordinary rally, so a rally nobody has weighted is unweighted
// rather than worthless.
export const DEFAULT_TIME_FACTOR = 1;

export const MAX_TIME_FACTOR = 100;

export function isValidTimeFactor(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_TIME_FACTOR;
}

// A crew's score for one rally: what their finish position is worth, times how
// much the rally was worth.
//
// Rounded to two decimals because a time factor is written as 1.25 and a
// season total is read off a screen: without it, three results of 1.1 × 9 add
// up to 29.700000000000003. The rounding is on each result rather than on the
// total, so what is shown per rally is exactly what was added up.
export function resultPoints(
  position: number,
  timeFactor: number,
  table: readonly PointsBand[]
): number {
  const points = pointsForPosition(position, table) * timeFactor;
  return Math.round(points * 100) / 100;
}
