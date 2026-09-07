// Local run history.
//
// IndexedDB rather than cookies or localStorage: results run to tens of KB per
// run, cookies cap at ~4 KB and would be sent on every request (there is no
// server to send them to), and localStorage is synchronous and ~5 MB. This is
// also the storage Phase 3's run history builds on, so it is worth doing
// properly now.
//
// Everything stays on the device. No run ever leaves the browser.

import type { MethodResult } from "./types";

const DB_NAME = "vq-playground";
const STORE = "runs";
const DB_VERSION = 1;

/** One completed run, as stored. */
export type RunRecord = {
  /** Milliseconds since the epoch; also the primary key. */
  id: number;
  /** The config that produced it, so a run can be re-read or re-run. */
  config: string;
  /** Which dataset it ran against. */
  dataset: string;
  results: MethodResult[];
  elapsedSeconds: number;
};

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}

/** Run `work` in a transaction and settle when the transaction does. */
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    // Surface the transaction's error too: a write can fail after the request
    // itself succeeded (quota, for instance).
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveRun(record: RunRecord): Promise<void> {
  await transact("readwrite", (store) => store.put(record));
}

/** Every stored run, newest first. */
export async function listRuns(): Promise<RunRecord[]> {
  const all = await transact<RunRecord[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => b.id - a.id);
}

export async function deleteRun(id: number): Promise<void> {
  await transact("readwrite", (store) => store.delete(id));
}

export async function clearRuns(): Promise<void> {
  await transact("readwrite", (store) => store.clear());
}
