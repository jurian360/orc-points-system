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
//   * the delta starts at 0 at the start of the rally;
//   * the start of the *first* stage is free: the rally begins there, so it
//     costs nothing and does not move the delta. Every other control, the start
//     of a later stage included, is scored;
//   * each control costs 1 penalty point per minute the delta moved since the
//     previous control — arriving +5 costs 5, and then dropping back from +5 to
//     +3 costs another 2 (the participant has to *keep* their delta, not undo
//     it);
//   * a GTC outside its window (default 15 minutes early / 30 minutes late)
//     costs a flat maximum (default 60) and the running delta reverts to the
//     last valid one — a control passed outside its window never moves it;
//   * the finish of a stage that is followed by another stage costs, when it is
//     outside its window, that same maximum *plus* the length of the break after
//     the stage, because the break itself varies per stage;
//   * the finish of the last stage has a wider window (default 15 early / 60
//     late); outside it the participant is disqualified;
//   * a control the stage *does* use (it has an IPT 0) but that has no WPT is a
//     control the participant missed, and it is charged like one: a GTC costs
//     the same flat maximum (default 60), the finish costs its own, higher
//     maximum (`missingFinishPenalty`, default 90) plus the break after the
//     stage when another stage follows. Like a blown window it never moves the
//     delta. The start row has no window and so has no maximum either: an
//     untimed start costs nothing and leaves the delta where it was;
//   * the delta keeps running across stages, up to the last one.
//
// The windows, the maximum and the break are stage settings (`timeConfig`) so
// an event can be run with different limits without touching this file.
//
// This module is shared by the API and the React views on purpose: the times
// shown on a card must agree with the total stored on the sheet. Like
// `scoring.ts`, it is the single home of these rules — never re-implement a
// rule in a component or a route.

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
  // The start of the first stage of a rally: shown, but never scored.
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
  // Delta the participant carried in from the previous stage.
  startDelta?: number;
  // The start row of the first stage of a rally is where the delta begins, so
  // it is free; the start of any later stage is scored like any other control.
  isFirstStage?: boolean;
  // The finish of the last stage is a disqualification, not a penalty.
  isFinalStage: boolean;
}

// Score the 10 time rows of one stage for one participant.
export function scoreStageTimes({
  timeScoreKey,
  timeConfig,
  eq,
  entries,
  startDelta = 0,
  isFirstStage = false,
  isFinalStage,
}: ScoreStageTimesInput): StageTimeResult {
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

    const free = kind === 'start' && isFirstStage;

    // The stage uses this control, but the sheet has no usable WPT for it: the
    // participant missed it (or nobody typed it in), and a missed control costs
    // its maximum. Exceptions: the free start of the first stage, and the start
    // of any other stage — a start has no window, so it has no maximum either.
    if (actual === null) {
      let missingStrafp = 0;
      if (!free && kind === 'gtc') {
        missingStrafp = config.outOfWindowPenalty;
      } else if (!free && kind === 'finish') {
        // The break after the stage is lost with the finish, exactly as it is
        // when the finish is passed outside its window.
        missingStrafp =
          config.missingFinishPenalty + (isFinalStage ? 0 : config.breakMinutes);
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
        disqualified: false,
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
      if (kind === 'finish' && isFinalStage) {
        // Past the finish window of the last stage the participant is out of
        // the rally; the maximum is still charged so the card adds up.
        rowDisqualified = true;
        disqualified = true;
        strafp = config.outOfWindowPenalty;
      } else if (kind === 'finish') {
        // The break after the stage is lost as well, and it differs per stage.
        strafp = config.outOfWindowPenalty + config.breakMinutes;
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
  timeScoreKey?: TimeKeyRow[] | null;
  timeConfig?: Partial<StageTimeConfig> | null;
}

// Score every stage of a rally for one participant, carrying the delta from one
// stage into the next. `stages` must be in running order: the start of the first
// one is free, and the finish of the last one disqualifies instead of
// penalising.
export function scoreRallyTimes(
  stages: RallyStageTimeInput[],
  eq: number,
  entriesByStage: Map<string, TimeEntryRow[]>
): Map<string, StageTimeResult> {
  const results = new Map<string, StageTimeResult>();
  let delta = 0;

  stages.forEach((stage, index) => {
    const result = scoreStageTimes({
      timeScoreKey: stage.timeScoreKey,
      timeConfig: stage.timeConfig,
      eq,
      entries: entriesByStage.get(stage.stageId) || [],
      startDelta: delta,
      isFirstStage: index === 0,
      isFinalStage: index === stages.length - 1,
    });
    results.set(stage.stageId, result);
    delta = result.endDelta;
  });

  return results;
}

// Highest time penalty a stage can hand out, used for the "max" overview on the
// stage form. The start row is left out: it has no window, so no maximum — an
// untimed start is free too.
export function maxStageTimePenalty(
  timeScoreKey: TimeKeyRow[] | null | undefined,
  timeConfig: Partial<StageTimeConfig> | null | undefined,
  isFinalStage: boolean
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
        (isFinalStage ? 0 : config.breakMinutes)
      );
    }
    // A GTC costs the same maximum whether it was blown or missed.
    return total + config.outOfWindowPenalty;
  }, 0);
}
