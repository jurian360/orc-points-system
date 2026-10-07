// The offline workspace's storage: IndexedDB, browser only.
//
// No library: the whole surface needed is "put, get, list by rally, delete",
// the same trade-off app/lib/spreadsheet.ts and app/lib/qrcode.ts make for
// their formats. Two stores:
//
//   * `rallies` — the downloaded snapshot of a rally without its sheets: the
//     stages with their keys in running order, the routes, the entry list and
//     who downloaded it (app/api/rallies/[id]/offline).
//   * `sheets` — one record per card, keyed `stageId:eq` (a stage holds one
//     sheet per participant, exactly as the server's unique index says),
//     indexed by rally. A record is the server's copy until an official changes
//     it here; from then on it is `dirty` and waits to be uploaded.
//
// See "Offline mode" in CLAUDE.md.

const DB_NAME = 'sark-offline';
const DB_VERSION = 1;
const RALLIES = 'rallies';
const SHEETS = 'sheets';

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;

  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store data for offline use.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RALLIES)) {
        db.createObjectStore(RALLIES, { keyPath: 'rallyId' });
      }
      if (!db.objectStoreNames.contains(SHEETS)) {
        const sheets = db.createObjectStore(SHEETS, { keyPath: 'key' });
        sheets.createIndex('rallyId', 'rallyId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    // A failed open must not stick: the next call tries again.
    opening = null;
    throw error;
  });

  return opening;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll<T>(store: 'rallies' | 'sheets'): Promise<T[]> {
  const db = await openDb();
  return result(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}

export async function getOne<T>(store: 'rallies' | 'sheets', key: string): Promise<T | undefined> {
  const db = await openDb();
  return result(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<
    T | undefined
  >;
}

export async function getSheetsOfRally<T>(rallyId: string): Promise<T[]> {
  const db = await openDb();
  const index = db.transaction(SHEETS, 'readonly').objectStore(SHEETS).index('rallyId');
  return result(index.getAll(rallyId)) as Promise<T[]>;
}

// Writes and deletes in one transaction, so a download or an upload is stored
// whole or not at all.
export async function write(changes: {
  rallies?: unknown[];
  sheets?: unknown[];
  deleteRallies?: string[];
  deleteSheets?: string[];
}): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([RALLIES, SHEETS], 'readwrite');
  const rallies = transaction.objectStore(RALLIES);
  const sheets = transaction.objectStore(SHEETS);

  for (const key of changes.deleteSheets || []) sheets.delete(key);
  for (const key of changes.deleteRallies || []) rallies.delete(key);
  for (const record of changes.rallies || []) rallies.put(record);
  for (const record of changes.sheets || []) sheets.put(record);

  await done(transaction);
}
