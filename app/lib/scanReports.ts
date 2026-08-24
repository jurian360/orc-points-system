import 'server-only';

// Reading the stored scan locations back out for the officials' pages.
//
// The rules live in app/lib/scanLocations.ts, which is shared with the browser.
// This is the database half: turning the sheets of a stage into the records
// that module scores, and reading a stage's own settings.

import { AnswerSheet, Participant } from '../models';
import {
  buildScanReport,
  DEFAULT_SCAN_RADIUS_METERS,
  type CardSummary,
  type ScanRecord,
  type ScanReference,
  type ScanReport,
} from './scanLocations';

export interface CrewRow {
  eq: number;
  classification: string;
  driverName: string;
  navigatorName: string;
}

// The radius this stage flags on. Stored per stage so an event with signs in a
// forest, where a fix drifts, can be run wider than one in a village.
export function stageScanRadius(stage: any): number {
  const radius = stage?.locationConfig?.radiusMeters;
  return typeof radius === 'number' && radius > 0 ? radius : DEFAULT_SCAN_RADIUS_METERS;
}

// Where officials have pinned the signs of this stage, if they have.
export function stageScanReferences(stage: any): ScanReference[] {
  const references = Array.isArray(stage?.scanReferences) ? stage.scanReferences : [];

  return references
    .filter(
      (reference: any) =>
        typeof reference?.latitude === 'number' && typeof reference?.longitude === 'number'
    )
    .map((reference: any) => ({
      rowNumber: Number(reference.rowNumber) || 0,
      letter: String(reference.letter || '').toUpperCase(),
      latitude: reference.latitude,
      longitude: reference.longitude,
    }));
}

// The scans of one sheet, as the report reads them. A sheet written by an
// official or by a time import simply has none.
export function sheetScanRecords(sheet: any): ScanRecord[] {
  const scans = Array.isArray(sheet?.scanLocations) ? sheet.scanLocations : [];

  return scans.map((scan: any) => ({
    eq: sheet.eq,
    rowNumber: Number(scan.rowNumber) || 0,
    column: Number(scan.column) || 0,
    letter: String(scan.letter || '').toUpperCase(),
    latitude: typeof scan.latitude === 'number' ? scan.latitude : null,
    longitude: typeof scan.longitude === 'number' ? scan.longitude : null,
    accuracy: typeof scan.accuracy === 'number' ? scan.accuracy : 0,
    scannedAt: scan.scannedAt ? new Date(scan.scannedAt).toISOString() : null,
  }));
}

// How many ORC letters a card carries. Compared with the number of scans on it,
// which is what says a letter was typed rather than scanned.
export function sheetLetterCount(sheet: any): number {
  const answers = Array.isArray(sheet?.answers) ? sheet.answers : [];

  return answers.reduce((total: number, row: any) => {
    const letters = Array.isArray(row?.selectedAnswers) ? row.selectedAnswers : [];
    return total + letters.filter((letter: unknown) => Boolean(letter)).length;
  }, 0);
}

// The whole report of one stage, straight from its sheets.
export async function buildStageScanReport(stage: any): Promise<ScanReport> {
  const sheets = await AnswerSheet.find({ stageId: stage._id }).select(
    'eq answers scanLocations'
  );

  const records = sheets.flatMap((sheet: any) => sheetScanRecords(sheet));
  const cards: CardSummary[] = sheets.map((sheet: any) => ({
    eq: sheet.eq,
    letters: sheetLetterCount(sheet),
  }));

  return buildScanReport(
    records,
    stageScanReferences(stage),
    stageScanRadius(stage),
    cards
  );
}

// The crews of a rally, so a flagged EQ has a name next to it.
export async function loadCrews(rallyId: unknown): Promise<CrewRow[]> {
  const participants = await Participant.find({ rallyId }).sort({ eq: 1 });

  return participants.map((participant: any) => ({
    eq: participant.eq,
    classification: participant.classification || '',
    driverName: participant.driverName || '',
    navigatorName: participant.navigatorName || '',
  }));
}
