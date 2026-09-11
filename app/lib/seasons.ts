// A **season**: one rally year, and the two numbers that decide how it is won.
//
// The club rides about ten rallies a year. Some of them are unofficial — a
// training run, a rit that did not make the calendar — and those are ridden and
// scored exactly like any other but do not count towards the year
// (`Rally.countsForSeason`). What is left is the season, and a crew's standing
// in it is read off those rallies under the two rules below.
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
// default: the club has always totalled the season. Setting it to 3 counts each
// crew's three best rallies, which is what a season with a long calendar
// usually does — riding a fourth rally can then only help, never hurt.
export const ALL_RESULTS = 0;

export const MAX_COUNTING_RESULTS = 50;

export interface SeasonSettings {
  year: number;
  // The lowest `countingResults` rally totals of a crew are added up. 0 counts
  // every rally they rode.
  countingResults: number;
  minimumRallies: number;
}

// A season nobody has configured. Every year exists — there is no "create a
// season" step, because a rally with a date in it *is* the season starting —
// so this is what a year answers with until an official changes it.
export function defaultSeasonSettings(year: number): SeasonSettings {
  return {
    year,
    countingResults: ALL_RESULTS,
    minimumRallies: DEFAULT_MINIMUM_RALLIES,
  };
}

// The counting rule in a sentence, for the heading above the standings. It is
// the one thing a reader has to know to understand the numbers in front of
// them, so it is printed rather than left to a settings page they would have to
// go and open.
export function countingRuleLabel(settings: SeasonSettings): string {
  const minimum = `at least ${settings.minimumRallies} official ${
    settings.minimumRallies === 1 ? 'rally' : 'rallies'
  } with the same partner`;

  if (settings.countingResults === ALL_RESULTS) {
    return `Every official rally counts; a crew needs ${minimum}.`;
  }

  return (
    `The best ${settings.countingResults} result${settings.countingResults === 1 ? '' : 's'} ` +
    `of each crew count; a crew needs ${minimum}.`
  );
}

// True when the settings are usable. A season that counts fewer results than it
// demands rallies is not wrong — "ride 3, best 2 count" is a real rule — but a
// zero or negative minimum would place a crew who rode nothing.
export function isValidSeasonSettings(settings: SeasonSettings): boolean {
  return (
    Number.isInteger(settings.minimumRallies) &&
    settings.minimumRallies >= 1 &&
    settings.minimumRallies <= MAX_COUNTING_RESULTS &&
    Number.isInteger(settings.countingResults) &&
    settings.countingResults >= 0 &&
    settings.countingResults <= MAX_COUNTING_RESULTS
  );
}
