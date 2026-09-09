// Time (TSD) penalty scoring for rally stages.
//
// The sport is a time-speed-distance rally: every participant starts one minute
// after the previous one, so the whole timetable of a stage is written down once
// for participant 0 ("IPT 0") and shifted by the participant number:
//
//     IPT(eq, row) = IPT0(row) + eq minutes
//
// A stage has 10 time rows:
//
//   row 1      START  — the start of the stage
//   rows 2..9  GTC    — "Geheime Tijds Controle", a secret time control the
//                       participant does not know about beforehand. A stage
//                       uses as many as it needs (2, 4, ...); a row with no
//                       IPT 0 is simply not a checkpoint of that stage.
//   row 10     FINISH — the finish of the stage
//
// Officials type the WPT ("Werkelijke Passeer Tijd") — the time the participant
// actually passed the control. The difference against that participant's IPT is
// the *delta*, in minutes.
//
// Scoring is on the *change* of the delta, not on the delta itself:
//
//   * the delta starts at 0 at the start of every **route**, and keeps running
//     across the stages inside it. A rally with no routes is one route holding
//     every stage, so there the delta starts at 0 once and runs to the last
//     stage — which is what this file always did (app/lib/routes.ts);
//   * the start of the first stage *of a route* is free: the leg begins there,
//     so it costs nothing and does not move the delta. Every other control, the
//     start of a later stage of the same route included, is scored;
//   * each control costs 1 penalty point per minute the delta moved since the
//     previous control — arriving +5 costs 5, and then dropping back from +5 to
//     +3 costs another 2 (the participant has to *keep* their delta, not undo
//     it);
//   * a GTC outside its window (default 15 minutes early / 30 minutes late)
//     costs a flat maximum (default 60) and the running delta reverts to the
//     last valid one — a control passed outside its window never moves it;
//   * the finish of a stage that is followed by another stage *of the same
//     route* costs, when it is outside its window, that same maximum *plus* the
//     length of the break after the stage, because the break itself varies per
//     stage. The finish of a stage that **ends its route** carries no break: the
//     next leg re-starts the crew anyway, so there is nothing to carry into it;
//   * the finish of the last stage has a wider window (default 15 early / 60
//     late); outside it — and when it has no time at all, a DNF — the
//     participant is disqualified. **Only the last stage of the last route**
//     disqualifies: blowing the finish of an intermediate route costs the
//     maximum and no more, because the crew went on to ride the next leg;
//   * a control the stage *does* use (it has an IPT 0) but that has no WPT is a
//     control the participant missed, and it is charged like one: a GTC costs
//     the same flat maximum (default 60), the finish costs its own, higher
//     maximum (`missingFinishPenalty`, default 90) plus the break after the
//     stage when another stage of the same route follows. Like a blown window it
//     never moves the delta. A missed finish of the last stage *of the last
//     route* is a DNF: the participant never finished the rally, so they are
//     disqualified as well as charged. The start row has no window and so has no
//     maximum either: an untimed start costs nothing and leaves the delta where
//     it was.
//
// The windows and the two maximums are stage settings, so the stage that closes
// a route can be given its own closing window and its own missing-finish
// penalty without either becoming a route-level setting.
//
// The windows, the maximum and the break are stage settings (`timeConfig`) so
// an event can be run with different limits without touching this file.
//
// This module is shared by the API and the React views on purpose: the times
// shown on a card must agree with the total stored on the sheet. Like
// `scoring.ts`, it is the single home of these rules — never re-implement a
// rule in a component or a route.

import { legPositions } from './routes';

export const PENALTY_PER_MINUTE = 1;

// The fixed 10 rows of the time column of the controlekaart.
export const TIME_ROWS = 10;
export const START_ROW = 1;
export const FINISH_ROW = 10;

export type TimeRowKind = 'start' | 'gtc' | 'finish';

export interface StageTimeConfig {
  // Length in minutes of the break after this stage. Only used on the finish
  // row of a stage that is followed by another stage.
  breakMinutes: number;
  // GTC window, in minutes early / late around the participant's IPT.
  gtcEarlyWindow: number;
  gtcLateWindow: number;
  // Finish window, in minutes early / late around the participant's IPT.
  finishEarlyWindow: number;
  finishLateWindow: number;
  // Flat penalty for a control passed outside its window, and for a GTC the
  // participant has no time for at all.
  outOfWindowPenalty: number;
  // Penalty for a finish with no WPT — a finish the participant missed. Higher
  // than `outOfWindowPenalty`, and charged plus the break after the stage while
  // this is not the last stage.
  missingFinishPenalty: number;
}

export const DEFAULT_TIME_CONFIG: StageTimeConfig = {
  breakMinutes: 0,
  gtcEarlyWindow: 15,
  gtcLateWindow: 30,
  finishEarlyWindow: 15,
  finishLateWindow: 60,
  outOfWindowPenalty: 60,
  missingFinishPenalty: 90,
};

// A stage's time key row: the ideal passage time of participant 0.
export interface TimeKeyRow {
  rowNumber: number;
  ipt?: string;
}

// A sheet's time row: the actual passage time typed in by an official.
export interface TimeEntryRow {
  rowNumber: number;
  wpt?: string;
}

export interface ScoredTimeRow {
  rowNumber: number;
  kind: TimeRowKind;
  // False when the stage does not use this row as a checkpoint (no IPT 0).
  active: boolean;
  ipt: string; // this participant's ideal passage time
  wpt: string;
  plusMinus: string;
  delta: number | null;
  strafp: number;
  outOfWindow: boolean;
  // True when the stage uses this control but the sheet has no WPT for it: the
  // participant missed it, and it is charged its maximum.
  missing: boolean;
  disqualified: boolean;
  // The start of the first stage of a route: shown, but never scored. On a rally
  // with no routes that is the first stage of the rally, as it always was.
  free: boolean;
}

export interface StageTimeResult {
  rows: ScoredTimeRow[];
  totalPenalty: number;
  startDelta: number;
  endDelta: number;
  disqualified: boolean;
}

export function timeRowKind(rowNumber: number): TimeRowKind {
  if (rowNumber === START_ROW) return 'start';
  if (rowNumber === FINISH_ROW) return 'finish';
  return 'gtc';
}

// Label used in the UI: START, GTC 1..8 or FINISH.
export function timeRowLabel(rowNumber: number): string {
  const kind = timeRowKind(rowNumber);
  if (kind === 'start') return 'START';
  if (kind === 'finish') return 'FINISH';
  return `GTC ${rowNumber - 1}`;
}

// Clock time -> minutes since midnight. Accepts the shapes officials actually
// type on a card: "8:05", "08:05", "8.05", "805", "0805". Returns null for
// anything else, which is how a blank or unusable cell stays unscored.
export function parseClock(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let hours: number;
  let minutes: number;

  const separated = /^(\d{1,2})[:.h](\d{2})$/.exec(trimmed);
  if (separated) {
    hours = Number(separated[1]);
    minutes = Number(separated[2]);
  } else if (/^\d{3,4}$/.test(trimmed)) {
    hours = Number(trimmed.slice(0, trimmed.length - 2));
    minutes = Number(trimmed.slice(-2));
  } else {
    return null;
  }

  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Minutes since midnight -> "HH:MM", wrapping around midnight so a stage that
// runs past 00:00 keeps working.
export function formatClock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Signed minutes between an actual and an ideal clock time, normalised to
// [-720, 720) so passing just after midnight against an ideal of 23:55 reads as
// +5 and not as -1435.
export function minutesBetween(actual: number, ideal: number): number {
  return ((((actual - ideal + 720) % 1440) + 1440) % 1440) - 720;
}

// The "+/-" cell of the card: a signed number of minutes.
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

export function resolveTimeConfig(config?: Partial<StageTimeConfig> | null): StageTimeConfig {
  return { ...DEFAULT_TIME_CONFIG, ...(config || {}) };
}

// The ideal passage time of participant `eq` on a row, given the IPT of
// participant 0 — one minute per participant number.
export function participantIpt(ipt0Minutes: number, eq: number): number {
  return ipt0Minutes + eq;
}

export interface ScoreStageTimesInput {
  timeScoreKey?: TimeKeyRow[] | null;
  timeConfig?: Partial<StageTimeConfig> | null;
  eq: number;
  entries?: TimeEntryRow[] | null;
  // Delta the participant carried in from the previous stage. Zero at the start
  // of every route: a route boundary neutralises it (app/lib/routes.ts).
  startDelta?: number;
  // The first stage of its route. Its start row is where the leg's delta begins,
  // so it is free; the start of any later stage of the same route is scored like
  // any other control.
  startsRoute?: boolean;
  // The last stage of its route: no further stage of the same route follows, so
  // the break after this stage is not charged with its finish.
  endsRoute: boolean;
  // The last stage of the last route — the rally's own finish. Outside its
  // window, or with no finish time at all, the participant is disqualified. It
  // implies `endsRoute`: the rally's finish has nothing behind it either.
  //
  // These two used to be one flag, because on a rally with no routes they are
  // one stage. They are separate now because a route's last stage costs no
  // break but does *not* put a crew out of the rally — they ride the next leg.
  endsRally: boolean;
}

// Score the 10 time rows of one stage for one participant.
export function scoreStageTimes({
  timeScoreKey,
  timeConfig,
  eq,
  entries,
  startDelta = 0,
  startsRoute = false,
  endsRoute,
  endsRally,
}: ScoreStageTimesInput): StageTimeResult {
  // Nothing follows this stage inside its own leg, so its finish carries no
  // break. Derived from either flag rather than from `endsRoute` alone, so a
  // caller that sets only the rally flag cannot charge a break the rally's
  // finish does not have.
  const endsLeg = endsRoute || endsRally;
  const config = resolveTimeConfig(timeConfig);
  const key = timeScoreKey || [];
  const entryRows = entries || [];

  let runningDelta = startDelta;
  let disqualified = false;
  let totalPenalty = 0;

  const rows: ScoredTimeRow[] = Array.from({ length: TIME_ROWS }, (_, index) => {
    const rowNumber = index + 1;
    const kind = timeRowKind(rowNumber);
    const entry = entryRows.find((row) => row.rowNumber === rowNumber);
    const wpt = (entry?.wpt || '').trim();

    const ipt0 = parseClock(key.find((row) => row.rowNumber === rowNumber)?.ipt);

    // No IPT 0 means this stage does not use the row as a checkpoint.
    if (ipt0 === null) {
      return {
        rowNumber,
        kind,
        active: false,
        ipt: '',
        wpt,
        plusMinus: '',
        delta: null,
        strafp: 0,
        outOfWindow: false,
        missing: false,
        disqualified: false,
        free: false,
      };
    }

    const idealMinutes = participantIpt(ipt0, eq);
    const ipt = formatClock(idealMinutes);
    const actual = parseClock(wpt);

    const free = kind === 'start' && startsRoute;

    // The stage uses this control, but the sheet has no usable WPT for it: the
    // participant missed it (or nobody typed it in), and a missed control costs
    // its maximum. Exceptions: the free start of the first stage, and the start
    // of any other stage — a start has no window, so it has no maximum either.
    if (actual === null) {
      let missingStrafp = 0;
      let missingDisqualified = false;

      if (!free && kind === 'gtc') {
        missingStrafp = config.outOfWindowPenalty;
      } else if (!free && kind === 'finish') {
        // The break after the stage is lost with the finish, exactly as it is
        // when the finish is passed outside its window — unless nothing follows
        // this stage in its own leg, because then there is no break to lose.
        missingStrafp =
          config.missingFinishPenalty + (endsLeg ? 0 : config.breakMinutes);
        if (endsRally) {
          // Never finished the rally: a DNF, ranked with the participants who
          // came in outside the finish window. The maximum is still charged so
          // the card adds up. Missing the finish of an *intermediate* route is
          // not this: the crew rode the next leg, so they are charged and stay
          // in the rally.
          missingDisqualified = true;
          disqualified = true;
        }
      }
      // `runningDelta` is left alone: a control with no time never moves it.
      totalPenalty += missingStrafp;

      return {
        rowNumber,
        kind,
        active: true,
        ipt,
        wpt,
        plusMinus: '',
        delta: null,
        strafp: missingStrafp,
        outOfWindow: false,
        missing: missingStrafp > 0,
        disqualified: missingDisqualified,
        free,
      };
    }

    const delta = minutesBetween(actual, idealMinutes);

    // The start of the first stage is where the rally begins: it is shown, but
    // it neither costs points nor moves the delta, so a participant who is sent
    // away late does not get to keep that as their delta.
    if (free) {
      return {
        rowNumber,
        kind,
        active: true,
        ipt,
        wpt,
        plusMinus: formatDelta(delta),
        delta,
        strafp: 0,
        outOfWindow: false,
        missing: false,
        disqualified: false,
        free,
      };
    }

    // The start of a later stage has no window: however far off it is, it only
    // moves the delta the participant then has to hold.
    const early = kind === 'gtc' ? config.gtcEarlyWindow : config.finishEarlyWindow;
    const late = kind === 'gtc' ? config.gtcLateWindow : config.finishLateWindow;
    const outOfWindow = kind !== 'start' && (delta < -early || delta > late);

    let strafp: number;
    let rowDisqualified = false;

    if (outOfWindow) {
      if (kind === 'finish') {
        // The break after the stage is lost as well, and it differs per stage —
        // unless nothing follows this stage in its own leg, because then there
        // is no break behind it.
        strafp = config.outOfWindowPenalty + (endsLeg ? 0 : config.breakMinutes);
        if (endsRally) {
          // Past the finish window of the rally's own finish the participant is
          // out of it; the maximum is still charged so the card adds up. A
          // route's finish is only a penalty — the next leg is still theirs to
          // ride.
          rowDisqualified = true;
          disqualified = true;
        }
      } else {
        strafp = config.outOfWindowPenalty;
      }
      // `runningDelta` is deliberately left alone: a control passed outside its
      // window does not move the delta, which reverts to the last valid one.
    } else {
      strafp = Math.abs(delta - runningDelta) * PENALTY_PER_MINUTE;
      runningDelta = delta;
    }

    totalPenalty += strafp;

    return {
      rowNumber,
      kind,
      active: true,
      ipt,
      wpt,
      plusMinus: formatDelta(delta),
      delta,
      strafp,
      outOfWindow,
      missing: false,
      disqualified: rowDisqualified,
      free,
    };
  });

  return { rows, totalPenalty, startDelta, endDelta: runningDelta, disqualified };
}

export interface RallyStageTimeInput {
  stageId: string;
  // The route (leg) this stage is ridden in, or null when the rally has no
  // routes — one implicit leg, and the behaviour the app has always had.
  //
  // Required rather than optional on purpose. A caller that forgot it would
  // silently score a two-leg rally as one, charging every crew the delta they
  // carried out of the previous leg, and there are *two* independent callers of
  // this function — the server (app/lib/rescore.ts) and the entry form's live
  // preview (app/components/AnswerSheetForm.tsx). The compiler is the only
  // thing that can catch a missing pass-through between them.
  routeId: string | null;
  timeScoreKey?: TimeKeyRow[] | null;
  timeConfig?: Partial<StageTimeConfig> | null;
}

// Score every stage of a rally for one participant, carrying the delta from one
// stage into the next — and starting it again from zero at every route
// boundary.
//
// `stages` must be in running order, grouped by route: the routes in their
// order, and inside a route the stages in theirs (`orderStagesByRoute` in
// app/lib/routes.ts, which is what `GET /api/stages` returns). The leg
// boundaries are read as adjacency on `routeId`, so a list that is not grouped
// reads as more legs than the rally has.
export function scoreRallyTimes(
  stages: RallyStageTimeInput[],
  eq: number,
  entriesByStage: Map<string, TimeEntryRow[]>
): Map<string, StageTimeResult> {
  const results = new Map<string, StageTimeResult>();
  const positions = legPositions(stages);
  let delta = 0;

  stages.forEach((stage, index) => {
    const position = positions[index];

    // A route boundary neutralises the delta: the crew is re-started on a fresh
    // schedule, so the next leg begins from zero.
    //
    // This is *not* the same thing as the free start row below, and both are
    // needed. The free row returns without assigning `runningDelta`, so without
    // this reset the first GTC of route 2 would still be measured against the
    // delta the crew carried out of route 1; and without the free row the start
    // itself would be charged the whole of that carry-over. On a rally with no
    // routes both fire only at index 0, where the delta is already zero, which
    // is why the two never had to be told apart before.
    if (position.startsRoute) delta = 0;

    const result = scoreStageTimes({
      timeScoreKey: stage.timeScoreKey,
      timeConfig: stage.timeConfig,
      eq,
      entries: entriesByStage.get(stage.stageId) || [],
      startDelta: delta,
      startsRoute: position.startsRoute,
      endsRoute: position.endsRoute,
      endsRally: position.endsRally,
    });
    results.set(stage.stageId, result);
    delta = result.endDelta;
  });

  return results;
}

// Highest time penalty a stage can hand out, used for the "max" overview on the
// stage form. The start row is left out: it has no window, so no maximum — an
// untimed start is free too.
//
// It takes only `endsRoute` — whether the break after the stage is lost with its
// finish. Whether the stage ends the *rally* is deliberately not a parameter: a
// disqualification is not a penalty, so it changes nothing this overview shows.
export function maxStageTimePenalty(
  timeScoreKey: TimeKeyRow[] | null | undefined,
  timeConfig: Partial<StageTimeConfig> | null | undefined,
  endsRoute: boolean
): number {
  const config = resolveTimeConfig(timeConfig);
  return (timeScoreKey || []).reduce((total, row) => {
    if (parseClock(row.ipt) === null) return total;
    const kind = timeRowKind(row.rowNumber);
    if (kind === 'start') return total;
    if (kind === 'finish') {
      // A finish can cost the out-of-window maximum or, when it was missed
      // altogether, the (higher) missing-finish maximum; both lose the break.
      return (
        total +
        Math.max(config.outOfWindowPenalty, config.missingFinishPenalty) +
        (endsRoute ? 0 : config.breakMinutes)
      );
    }
    // A GTC costs the same maximum whether it was blown or missed.
    return total + config.outOfWindowPenalty;
  }, 0);
}
