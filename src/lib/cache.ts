import type { FetchOutcome } from "./api";
import type { Cache } from "./types";

export const CACHE_KEY = "cache";
export const LOCK_MS = 10_000;
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_CAP_MS = 10 * 60_000;

export const EMPTY_CACHE: Cache = { snapshot: null, fetchedAt: 0, failStreak: 0, schemaVersion: 1 };

export function normalizeCache(raw: unknown): Cache {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_CACHE };
  const c = raw as Cache;
  return c.schemaVersion === 1 ? c : { ...EMPTY_CACHE };
}

export async function readCache(area: chrome.storage.StorageArea = chrome.storage.local): Promise<Cache> {
  const got = await area.get(CACHE_KEY);
  return normalizeCache(got[CACHE_KEY]);
}

export async function writeCache(cache: Cache, area: chrome.storage.StorageArea = chrome.storage.local): Promise<void> {
  await area.set({ [CACHE_KEY]: cache });
}

/** Time of the last fetch attempt, successful or not. Scheduling is based on this. */
export function lastAttemptAt(cache: Cache): number {
  return Math.max(cache.fetchedAt, cache.lastError?.at ?? 0);
}

export function isFresh(cache: Cache, maxAgeMs: number, nowMs: number): boolean {
  return nowMs - lastAttemptAt(cache) < maxAgeMs;
}

export function isLocked(cache: Cache, nowMs: number): boolean {
  return cache.fetchLock !== undefined && nowMs - cache.fetchLock < LOCK_MS && nowMs >= cache.fetchLock;
}

export function backoffMs(rateStreak: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, rateStreak - 1));
}

/**
 * Best-effort cross-tab lock. chrome.storage has no compare-and-set, so two tabs can very
 * rarely both win; that only costs one extra request.
 */
export async function tryAcquireLock(nowMs: number, area: chrome.storage.StorageArea = chrome.storage.local): Promise<boolean> {
  const cache = await readCache(area);
  if (isLocked(cache, nowMs)) return false;
  await writeCache({ ...cache, fetchLock: nowMs }, area);
  return true;
}

/** Folds a fetch outcome into the cache and releases the lock. Pure. */
export function applyOutcome(cache: Cache, outcome: FetchOutcome, nowMs: number): Cache {
  const base: Cache = { ...cache, fetchLock: undefined };
  if (outcome.ok) {
    return {
      snapshot: outcome.snapshot,
      fetchedAt: nowMs,
      failStreak: 0,
      rateStreak: 0,
      schemaVersion: 1,
    };
  }
  const next: Cache = {
    ...base,
    lastError: { kind: outcome.kind, at: nowMs },
    failStreak: cache.failStreak + 1,
  };
  if (outcome.kind === "rate") {
    const rateStreak = (cache.rateStreak ?? 0) + 1;
    const wait = Math.max(backoffMs(rateStreak), Math.min(outcome.retryAfterMs ?? 0, BACKOFF_CAP_MS));
    next.rateStreak = rateStreak;
    next.backoffUntil = nowMs + wait;
  }
  return next;
}
