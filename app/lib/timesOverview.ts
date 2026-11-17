// The WPT overview read two ways — on screen (`RallyTimesPanel`) and on paper
// (`/rallies/[id]/times/print`). Both have to pick the same columns, the same
// crews and the same line under a time, or the sheet an official checks the
// cards against is not the grid they were looking at. Pure and shared, client
// side only by use, like `standings.ts`.

import { crewLabel, type ClassificationValue } from './participants';
import type { RallyTimeCell, RallyTimeColumn, RallyTimeStage, RallyTimes } from '../types';

// What a cell shows underneath the WPT. The WPT itself is what the overview is
// for; the rest is the context an official wants while they are checking one
// control, and only one of them fits in a cell.
export type TimeDetail = 'delta' | 'ipt' | 'strafp' | 'none';

export const TIME_DETAIL_LABELS: Record<TimeDetail, string> = {
  delta: 'WPT + ⁺∕₋',
  ipt: 'WPT + IPT',
  strafp: 'WPT + strafp.',
  none: 'WPT only',
};

export const isTimeDetail = (value: unknown): value is TimeDetail =>
  typeof value === 'string' && value in TIME_DETAIL_LABELS;

// The line under a WPT for the chosen detail; '' when there is nothing to show.
export function timeCellDetail(cell: RallyTimeCell, detail: TimeDetail): string {
  if (detail === 'delta') return cell.plusMinus;
  if (detail === 'ipt') return cell.ipt;
  if (detail === 'strafp') return cell.strafp > 0 ? `${cell.strafp} p.` : '';
  return '';
}

// The columns a stage needs: the controls it uses, plus any row a time was
// imported onto without the key holding an IPT 0 for it — that mismatch is
// what the overview is there to show.
export function visibleTimeColumns(stage: RallyTimeStage): RallyTimeColumn[] {
  return stage.columns.filter(
    (column) =>
      column.active || stage.entries.some((entry) => entry.cells[column.rowNumber - 1]?.wpt)
  );
}

// Every EQ that appears in any stage, in number order: one row per crew.
export function rallyTimeEqs(data: RallyTimes | null): number[] {
  const all = new Set<number>();
  for (const stage of data?.stages || []) {
    for (const entry of stage.entries) all.add(entry.eq);
  }
  return Array.from(all).sort((a, b) => a - b);
}

export type CrewDetails = {
  classification: ClassificationValue;
  driverName: string;
  navigatorName: string;
};

export function crewDetailsByEq(data: RallyTimes | null): Map<number, CrewDetails> {
  const map = new Map<number, CrewDetails>();
  for (const participant of data?.participants || []) map.set(participant.eq, participant);
  return map;
}

// The search box and the class select over the crews: an EQ (or the start of
// one) or a piece of a crew name, and a class letter ('' is every class).
export function filterTimeEqs(
  eqs: number[],
  detailsByEq: Map<number, CrewDetails>,
  search: string,
  classFilter: string
): number[] {
  const term = search.trim().toLowerCase();
  return eqs.filter((eq) => {
    const details = detailsByEq.get(eq);
    if (classFilter && (details?.classification || '') !== classFilter) return false;
    if (!term) return true;
    if (String(eq).startsWith(term)) return true;
    return crewLabel(details).toLowerCase().includes(term);
  });
}
