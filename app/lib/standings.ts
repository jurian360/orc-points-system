// How a crew ends up in the results, and what a result sheet prints where a
// place would be. Pure and shared, client + server: the standings route decides
// the status, the dashboard and the printed sheet show it, and neither may
// invent a fourth one.
//
//   * `finished` — rode the rally and came in. These are the crews that are
//     ranked 1, 2, 3.
//   * `dnf` — "did not finish": started but did not come in. Either the last
//     stage's card puts them outside the finish window or has no finish time at
//     all (app/lib/timeScoring.ts disqualifies them), or they have no card for
//     the last stage at all. Their points stand and are printed; they are ranked
//     behind everyone who finished.
//   * `dns` — "did not start": a crew on the entry list with no card in the
//     whole rally. They are listed behind the DNF's — a crew who rode and
//     retired is ahead of one who never came to the start.

export type StandingsStatus = 'finished' | 'dnf' | 'dns';

// The order the three groups are ranked in.
export const STATUS_ORDER: Record<StandingsStatus, number> = {
  finished: 0,
  dnf: 1,
  dns: 2,
};

// What is printed instead of a place. A crew who did not finish has no place —
// they are behind the field because the standings have to put them somewhere,
// not because they came 32nd — so the sheet says what happened instead.
export const STATUS_LABEL: Record<StandingsStatus, string> = {
  finished: '',
  dnf: 'DNF',
  dns: 'DNS',
};

// The long form, for a tooltip or a banner.
export const STATUS_TITLE: Record<StandingsStatus, string> = {
  finished: '',
  dnf: 'Did not finish — no card for the last stage, or outside its finish window',
  dns: 'Did not start — no card in this rally at all',
};

export function isRanked(status: StandingsStatus): boolean {
  return status === 'finished';
}

// Which of the three a crew is in. Everything it needs is counted from the
// crew's sheets, so the standings route and the participant view can ask the
// same question of the same rule.
export interface StatusInput {
  // How many cards this crew has in the rally. None at all is a DNS.
  sheetsSubmitted: number;
  // A card of theirs disqualified them — the finish of the last stage, outside
  // its window or missing altogether (app/lib/timeScoring.ts).
  disqualified: boolean;
  // The rally has a last stage and this crew has no card for it. Not finishing
  // the last stage is not finishing the rally, whether that is written on the
  // card or shown by the card never being handed in.
  missingLastStageSheet: boolean;
}

export function resolveStatus({
  sheetsSubmitted,
  disqualified,
  missingLastStageSheet,
}: StatusInput): StandingsStatus {
  if (sheetsSubmitted === 0) return 'dns';
  if (disqualified || missingLastStageSheet) return 'dnf';
  return 'finished';
}
