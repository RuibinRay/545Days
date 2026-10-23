/**
 * IndexedDB persistence for worlds. Works on the main thread and in the Worker (both have IndexedDB).
 * Two stores: `worlds` (full records, a few MB each) and `summaries` (one small row per world) so the
 * saves list never loads a full world.
 */
import type { SavedSummary, SavedWorld } from "../sim/types";

const DB_NAME = "545days";
const DB_VERSION = 2;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available here"));
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("worlds")) db.createObjectStore("worlds", { keyPath: "id" });
      if (!db.objectStoreNames.contains("summaries")) {
        const s = db.createObjectStore("summaries", { keyPath: "id" });
        s.createIndex("updatedAt", "updatedAt");
      }
      // M7: achievements, one row per id, kept across worlds
      if (!db.objectStoreNames.contains("achievements")) db.createObjectStore("achievements", { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("could not open IndexedDB"));
    open.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

export function summarize(w: SavedWorld): SavedSummary {
  return {
    id: w.id,
    name: w.name,
    seed: w.seed,
    settlement: w.latest.settlements[0]?.name ?? "",
    day: w.latest.day,
    population: w.latest.citizens.filter((c) => c.alive).length,
    endingTitle: w.ending?.title ?? null,
    updatedAt: w.updatedAt,
    forkedFrom: w.forkedFrom,
  };
}

export async function putWorld(w: SavedWorld): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["worlds", "summaries"], "readwrite");
    tx.objectStore("worlds").put(w);
    tx.objectStore("summaries").put(summarize(w));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("save failed"));
    tx.onabort = () => reject(tx.error ?? new Error("save aborted"));
  });
}

export async function getWorld(id: string): Promise<SavedWorld | null> {
  const db = await openDb();
  const tx = db.transaction("worlds", "readonly");
  const r = await req(tx.objectStore("worlds").get(id) as IDBRequest<SavedWorld | undefined>);
  return r ?? null;
}

export async function listWorlds(): Promise<SavedSummary[]> {
  const db = await openDb();
  const tx = db.transaction("summaries", "readonly");
  const all = await req(tx.objectStore("summaries").getAll() as IDBRequest<SavedSummary[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteWorld(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["worlds", "summaries"], "readwrite");
    tx.objectStore("worlds").delete(id);
    tx.objectStore("summaries").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("delete failed"));
  });
}

export function newId(): string {
  // storage/ is outside sim/: non-deterministic ids are fine here (they never enter the simulation)
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `w-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// ───────────────────────── achievements (M7) ─────────────────────────

export interface AchievementRecord {
  id: string;
  /** Wall-clock time it was first earned. */
  earnedAt: number;
  /** World and day it was earned in. */
  world: string;
  day: number;
}

export async function listAchievements(): Promise<AchievementRecord[]> {
  const db = await openDb();
  const tx = db.transaction("achievements", "readonly");
  return req(tx.objectStore("achievements").getAll() as IDBRequest<AchievementRecord[]>);
}

/** Records an achievement unless it is already there; returns true when it was new. */
export async function earnAchievement(rec: AchievementRecord): Promise<boolean> {
  const db = await openDb();
  const tx = db.transaction("achievements", "readwrite");
  const store = tx.objectStore("achievements");
  const existing = await req(store.get(rec.id) as IDBRequest<AchievementRecord | undefined>);
  if (existing) return false;
  store.put(rec);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  return true;
}
