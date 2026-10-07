// The offline workspace's operations, browser only: download a rally, type and
// correct its cards, import a control's times, upload what changed and settle a
// conflict. See "Offline mode" in CLAUDE.md.
//
// Only what an official *typed* is stored on a card here — the letters, the
// WPT's, the merk letters and the Diversen count. Every number derived from
// them is computed when it is read (`scoreOfflineRally`), with the same pure
// modules the server scores with, so the copy in the browser has no stored
// total that could disagree with its own letters.

import { getAll, getOne, getSheetsOfRally, write } from './db';
import { scoreRallySheets, type SheetScore } from '../rallyScoring';
import { buildStandings } from '../standingsBuild';
import { typedSheetContent } from '../sheetContent';
import { TIME_ROWS } from '../timeScoring';
import type { Role } from '../roles';

// The upload's batch size; the route refuses more (MAX_SYNC_SHEETS in
// app/lib/validation.ts, which is server-only and cannot be imported here).
const SYNC_BATCH = 25;

// Fired on `window` after every change, so the navigation's badge and an open
// workspace re-read what is pending.
export const OFFLINE_CHANGE_EVENT = 'sark-offline-change';

export interface OfflineRally {
  rallyId: string;
  rally: { _id: string; name: string; code: string };
  routes: { _id: string; rallyId: string; name: string; order: number }[];
  // In running order, with their keys.
  stages: any[];
  participants: any[];
  // Who downloaded it. Decides what the workspace offers (the time import is an
  // admin's) — a courtesy, as in the online app: the upload is guarded on its own.
  user: { username: string; role: Role };
  downloadedAt: string;
}

export interface TypedAnswerRow {
  rowNumber: number;
  selectedAnswers: string[];
}

export interface TypedTimeRow {
  rowNumber: number;
  wpt: string;
}

export interface TypedMerkRow {
  rowNumber: number;
  merk: string;
}

export interface OfflineSheet {
  // `${stageId}:${eq}` — one card per participant per stage.
  key: string;
  rallyId: string;
  stageId: string;
  eq: number;
  // The sheet's `_id` and `revision` on the server, or null for a card typed
  // here that the server has never seen.
  serverId: string | null;
  baseRevision: number | null;
  // `typedSheetContent` of the server's copy, so a card corrected back to what
  // it was is not uploaded for nothing.
  serverContent: string | null;
  answers: TypedAnswerRow[];
  timePenalties: TypedTimeRow[];
  merkScores: TypedMerkRow[];
  diversenCount: number;
  submittedAt?: string;
  // Changed here and not uploaded yet.
  dirty: boolean;
  // Deleted here; uploaded as a delete.
  deleted: boolean;
  localUpdatedAt: number;
  // The upload found that somebody else changed the card meanwhile: the
  // server's copy (null if it was deleted there), until an official chooses.
  conflict?: { server: any | null };
  // The upload refused the card (a stage deleted meanwhile, say).
  error?: string;
}

// A card as the views read it: the record plus everything scored from it.
export type ScoredOfflineSheet = OfflineSheet & SheetScore & { _id: string };

export class OfflineSyncError extends Error {
  constructor(
    message: string,
    // `login` — the session ran out; `offline` — no connection; `server` — any
    // other refusal.
    public readonly reason: 'login' | 'offline' | 'server'
  ) {
    super(message);
  }
}

const sheetKey = (stageId: string, eq: number) => `${stageId}:${eq}`;

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_CHANGE_EVENT));
}

function typedAnswers(rows: any[] | undefined): TypedAnswerRow[] {
  return (rows || []).map((row) => ({
    rowNumber: Number(row?.rowNumber) || 0,
    selectedAnswers: (row?.selectedAnswers || []).map((letter: unknown) => String(letter ?? '')),
  }));
}

function typedTimes(rows: any[] | undefined): TypedTimeRow[] {
  return (rows || [])
    .map((row) => ({ rowNumber: Number(row?.rowNumber) || 0, wpt: String(row?.wpt ?? '') }))
    .filter((row) => row.rowNumber >= 1 && row.rowNumber <= TIME_ROWS);
}

function typedMerk(rows: any[] | undefined): TypedMerkRow[] {
  return (rows || []).map((row) => ({
    rowNumber: Number(row?.rowNumber) || 0,
    merk: String(row?.merk ?? ''),
  }));
}

function fromServerSheet(rallyId: string, sheet: any): OfflineSheet {
  const record: OfflineSheet = {
    key: sheetKey(String(sheet.stageId), sheet.eq),
    rallyId,
    stageId: String(sheet.stageId),
    eq: sheet.eq,
    serverId: String(sheet._id),
    baseRevision: typeof sheet.revision === 'number' ? sheet.revision : 0,
    serverContent: null,
    answers: typedAnswers(sheet.answers),
    timePenalties: typedTimes(sheet.timePenalties),
    merkScores: typedMerk(sheet.merkScores),
    diversenCount: Number(sheet.diversenCount) || 0,
    submittedAt: sheet.submittedAt,
    dirty: false,
    deleted: false,
    localUpdatedAt: 0,
  };
  record.serverContent = typedSheetContent(record);
  return record;
}

// Whether a record still differs from the server's copy it was based on.
function isDirty(record: OfflineSheet): boolean {
  if (record.deleted) return record.serverId !== null;
  if (record.serverContent === null) return true;
  return typedSheetContent(record) !== record.serverContent;
}

// --- Reading -----------------------------------------------------------------

export async function listOfflineRallies(): Promise<
  (OfflineRally & { pending: number; conflicts: number })[]
> {
  const [rallies, sheets] = await Promise.all([
    getAll<OfflineRally>('rallies'),
    getAll<OfflineSheet>('sheets'),
  ]);
  return rallies
    .map((rally) => {
      const own = sheets.filter((sheet) => sheet.rallyId === rally.rallyId);
      return {
        ...rally,
        pending: own.filter((sheet) => sheet.dirty).length,
        conflicts: own.filter((sheet) => sheet.conflict).length,
      };
    })
    .sort((a, b) => a.rally.name.localeCompare(b.rally.name));
}

export async function getOfflineRally(rallyId: string): Promise<OfflineRally | undefined> {
  return getOne<OfflineRally>('rallies', rallyId);
}

export async function getOfflineSheets(rallyId: string): Promise<OfflineSheet[]> {
  return getSheetsOfRally<OfflineSheet>(rallyId);
}

// Cards not yet uploaded, over every downloaded rally — the navigation's badge.
export async function pendingCount(): Promise<number> {
  try {
    const sheets = await getAll<OfflineSheet>('sheets');
    return sheets.filter((sheet) => sheet.dirty).length;
  } catch {
    return 0;
  }
}

// The rally scored and ranked from the copy in the browser: every card scored
// with `scoreRallySheets` and the standings built with `buildStandings` — the
// two functions the server stores and ranks the same cards with.
export function scoreOfflineRally(rally: OfflineRally, records: OfflineSheet[]) {
  const live = records.filter((record) => !record.deleted);
  const scored: ScoredOfflineSheet[] = scoreRallySheets(rally.stages, live).map(
    ({ sheet, score }) => ({ ...sheet, ...score, _id: sheet.key })
  );
  const standings = buildStandings({
    stages: rally.stages,
    routes: rally.routes,
    participants: rally.participants,
    sheets: scored,
  });
  return { sheets: scored, standings };
}

// --- Downloading -------------------------------------------------------------

async function fetchJson(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: 'no-store' });
  } catch {
    throw new OfflineSyncError('No connection to the server.', 'offline');
  }
  if (response.status === 401) {
    throw new OfflineSyncError('Your session has ended — log in again to continue.', 'login');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new OfflineSyncError(data?.error || `The server answered ${response.status}.`, 'server');
  }
  return data;
}

// Download (or refresh) a rally for offline use. A card changed here and not
// uploaded yet is kept as it is; every other card is replaced by the server's.
export async function downloadRally(rallyId: string): Promise<OfflineRally> {
  const data = await fetchJson(`/api/rallies/${encodeURIComponent(rallyId)}/offline`);

  const rally: OfflineRally = {
    rallyId: data.rally._id,
    rally: data.rally,
    routes: data.routes,
    stages: data.stages,
    participants: data.participants,
    user: data.user,
    downloadedAt: data.downloadedAt,
  };

  const local = await getSheetsOfRally<OfflineSheet>(rally.rallyId);
  const dirty = new Map(local.filter((record) => record.dirty).map((record) => [record.key, record]));

  const fromServer = (data.sheets as any[]).map((sheet) => fromServerSheet(rally.rallyId, sheet));
  const keep = fromServer.filter((record) => !dirty.has(record.key));
  const serverKeys = new Set(fromServer.map((record) => record.key));
  // A clean card the server no longer has was deleted there.
  const gone = local
    .filter((record) => !record.dirty && !serverKeys.has(record.key))
    .map((record) => record.key);

  await write({ rallies: [rally], sheets: keep, deleteSheets: gone });
  notify();
  await refreshOfflineShell();
  return rally;
}

// Ask the service worker to cache the workspace page and its scripts again, so
// it opens without a connection — and opens this deployment's version of it.
export async function refreshOfflineShell(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    registration?.active?.postMessage({ type: 'cache-offline-shell' });
  } catch {
    // No service worker (a development build): the data is still stored.
  }
}

export async function removeOfflineRally(rallyId: string): Promise<void> {
  const local = await getSheetsOfRally<OfflineSheet>(rallyId);
  await write({ deleteRallies: [rallyId], deleteSheets: local.map((record) => record.key) });
  notify();
}

export async function clearOfflineData(): Promise<void> {
  const rallies = await getAll<OfflineRally>('rallies');
  const sheets = await getAll<OfflineSheet>('sheets');
  await write({
    deleteRallies: rallies.map((rally) => rally.rallyId),
    deleteSheets: sheets.map((sheet) => sheet.key),
  });
  notify();
}

// --- Changing cards ----------------------------------------------------------

export interface TypedCard {
  eq: number;
  stageId: string;
  answers: { rowNumber: number; selectedAnswers: string[] }[];
  timePenalties: { rowNumber: number; wpt: string }[];
  merkScores: { rowNumber: number; merk: string }[];
  diversenCount: number;
}

// Save a card typed or corrected in the workspace. `previousKey` is the card
// being corrected; a correction that renumbers it is a delete of the old card
// plus a new one, exactly as moving a sheet is on the server.
export async function saveLocalSheet(
  rallyId: string,
  card: TypedCard,
  previousKey?: string
): Promise<OfflineSheet> {
  const key = sheetKey(card.stageId, card.eq);
  const now = Date.now();
  const changes: OfflineSheet[] = [];
  const deletes: string[] = [];

  if (previousKey && previousKey !== key) {
    const previous = await getOne<OfflineSheet>('sheets', previousKey);
    if (previous) {
      if (previous.serverId) {
        changes.push({ ...previous, deleted: true, dirty: true, localUpdatedAt: now });
      } else {
        deletes.push(previousKey);
      }
    }
  }

  const existing = await getOne<OfflineSheet>('sheets', key);
  const record: OfflineSheet = {
    key,
    rallyId,
    stageId: card.stageId,
    eq: card.eq,
    serverId: existing?.serverId ?? null,
    baseRevision: existing?.baseRevision ?? null,
    serverContent: existing?.serverContent ?? null,
    answers: typedAnswers(card.answers),
    timePenalties: typedTimes(card.timePenalties),
    merkScores: typedMerk(card.merkScores),
    diversenCount: Number(card.diversenCount) || 0,
    submittedAt: existing?.submittedAt ?? new Date(now).toISOString(),
    dirty: false,
    deleted: false,
    localUpdatedAt: now,
    conflict: existing?.conflict,
  };
  record.dirty = isDirty(record);
  changes.push(record);

  await write({ sheets: changes, deleteSheets: deletes });
  notify();
  return record;
}

export async function deleteLocalSheet(key: string): Promise<void> {
  const existing = await getOne<OfflineSheet>('sheets', key);
  if (!existing) return;

  if (existing.serverId) {
    await write({
      sheets: [{ ...existing, deleted: true, dirty: true, localUpdatedAt: Date.now() }],
    });
  } else {
    // Never uploaded: nothing to tell the server.
    await write({ deleteSheets: [key] });
  }
  notify();
}

// The times of one control, imported into the copy in the browser — the same
// rules as POST /api/stages/[id]/times/import, and the same answer, so the
// time-import wizard reads it unchanged: a crew not on the entry list is
// ignored, a crew with no card gets one holding only this time when asked to
// (and is skipped otherwise), and only the WPT of the one row is written.
export async function applyTimeImport(
  rallyId: string,
  stageId: string,
  rowNumber: number,
  times: { eq: number; wpt: string }[],
  createMissingSheets: boolean
) {
  const rally = await getOfflineRally(rallyId);
  if (!rally) throw new Error('This rally is not downloaded.');
  const entered = new Set(rally.participants.map((participant: any) => participant.eq));

  const local = await getSheetsOfRally<OfflineSheet>(rallyId);
  const byKey = new Map(local.map((record) => [record.key, record]));
  const now = Date.now();

  const changes: OfflineSheet[] = [];
  const skipped: number[] = [];
  const ignored: number[] = [];
  let updated = 0;
  let created = 0;

  for (const { eq, wpt } of times) {
    if (!entered.has(eq)) {
      ignored.push(eq);
      continue;
    }

    const key = sheetKey(stageId, eq);
    const existing = byKey.get(key);
    const withTime = (rows: TypedTimeRow[]) => [
      ...rows.filter((row) => row.rowNumber !== rowNumber),
      { rowNumber, wpt },
    ];

    if (existing && !existing.deleted) {
      updated++;
      const record = {
        ...existing,
        timePenalties: withTime(existing.timePenalties),
        localUpdatedAt: now,
      };
      record.dirty = isDirty(record);
      changes.push(record);
      continue;
    }

    if (!createMissingSheets) {
      skipped.push(eq);
      continue;
    }

    // A card that only holds a time, as the import route creates: an empty
    // card scores every letter of the keys as missing until it is typed. A card
    // deleted here and not uploaded yet comes back as this one.
    created++;
    const record: OfflineSheet = {
      key,
      rallyId,
      stageId,
      eq,
      serverId: existing?.serverId ?? null,
      baseRevision: existing?.baseRevision ?? null,
      serverContent: existing?.serverContent ?? null,
      answers: [],
      timePenalties: [{ rowNumber, wpt }],
      merkScores: [],
      diversenCount: 0,
      submittedAt: new Date(now).toISOString(),
      dirty: true,
      deleted: false,
      localUpdatedAt: now,
    };
    record.dirty = isDirty(record);
    changes.push(record);
  }

  await write({ sheets: changes });
  notify();

  return {
    rowNumber,
    total: updated + created,
    updated,
    created,
    skipped: skipped.length,
    skippedEqs: skipped,
    ignored: ignored.length,
    ignoredEqs: ignored,
  };
}

// --- Uploading ---------------------------------------------------------------

export interface SyncSummary {
  saved: number;
  conflicts: number;
  errors: number;
}

// Upload every card of a rally changed here, then download the rally again so
// the copy holds what the server scored. A card in conflict waits until an
// official has chosen (`resolveConflict`); a card changed again while its
// upload was under way stays pending for the next one.
// One upload per rally at a time: the navigation's automatic upload and the
// workspace's button can both ask, and the second one waits for the first.
const running = new Map<string, Promise<SyncSummary>>();

export function syncRally(rallyId: string): Promise<SyncSummary> {
  const current = running.get(rallyId);
  if (current) return current;
  const upload = uploadRally(rallyId).finally(() => running.delete(rallyId));
  running.set(rallyId, upload);
  return upload;
}

async function uploadRally(rallyId: string): Promise<SyncSummary> {
  const local = await getSheetsOfRally<OfflineSheet>(rallyId);
  const pending = local.filter((record) => record.dirty && !record.conflict);
  const summary: SyncSummary = { saved: 0, conflicts: 0, errors: 0 };

  for (let start = 0; start < pending.length; start += SYNC_BATCH) {
    const batch = pending.slice(start, start + SYNC_BATCH);
    const data = await fetchJson(`/api/rallies/${encodeURIComponent(rallyId)}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheets: batch.map((record) => ({
          stageId: record.stageId,
          eq: record.eq,
          baseRevision: record.baseRevision,
          deleted: record.deleted,
          answers: record.answers,
          timePenalties: record.timePenalties,
          merkScores: record.merkScores,
          diversenCount: record.diversenCount,
        })),
      }),
    });

    const sentAt = new Map(batch.map((record) => [record.key, record.localUpdatedAt]));
    const changes: OfflineSheet[] = [];
    const deletes: string[] = [];

    for (const result of (data?.results || []) as any[]) {
      const key = sheetKey(String(result.stageId), Number(result.eq));
      const current = await getOne<OfflineSheet>('sheets', key);
      // Changed again while this upload was on its way: the newer version is
      // the next upload's business.
      if (!current || current.localUpdatedAt !== sentAt.get(key)) continue;

      if (result.status === 'saved') {
        summary.saved++;
        if (current.deleted) {
          deletes.push(key);
        } else {
          // Clean from here on; the download below replaces it with the
          // server's scored copy and its new revision.
          changes.push({ ...current, dirty: false, error: undefined });
        }
      } else if (result.status === 'conflict') {
        summary.conflicts++;
        changes.push({ ...current, conflict: { server: result.sheet ?? null }, error: undefined });
      } else {
        summary.errors++;
        changes.push({ ...current, error: String(result.error || 'Refused by the server') });
      }
    }

    await write({ sheets: changes, deleteSheets: deletes });
    notify();
  }

  await downloadRally(rallyId);
  return summary;
}

// Settle a conflict: keep the card as typed here (it is uploaded over the
// server's copy on the next upload), or take the server's copy and drop the
// one typed here.
export async function resolveConflict(key: string, choice: 'mine' | 'server'): Promise<void> {
  const record = await getOne<OfflineSheet>('sheets', key);
  if (!record?.conflict) return;
  const server = record.conflict.server;

  if (choice === 'server') {
    if (server) {
      await write({ sheets: [fromServerSheet(record.rallyId, server)] });
    } else {
      await write({ deleteSheets: [key] });
    }
  } else {
    const rebased: OfflineSheet = {
      ...record,
      serverId: server ? String(server._id) : null,
      baseRevision: server ? (typeof server.revision === 'number' ? server.revision : 0) : null,
      serverContent: server ? typedSheetContent(server) : null,
      conflict: undefined,
      error: undefined,
      localUpdatedAt: Date.now(),
    };
    rebased.dirty = isDirty(rebased);
    // Deleted here and already gone there: nothing left to do.
    if (rebased.deleted && !server) {
      await write({ deleteSheets: [key] });
    } else {
      await write({ sheets: [rebased] });
    }
  }
  notify();
}
