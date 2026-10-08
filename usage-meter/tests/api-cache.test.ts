import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "../fixtures/usage.json";
import { createApi } from "../src/lib/api";
import { EMPTY_CACHE, LOCK_MS, applyOutcome, isFresh, readCache, tryAcquireLock, writeCache } from "../src/lib/cache";
import { fakeArea, MIN, SEC } from "./helpers";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "throw";

/** Fake fetch that answers each path from its own queue and records every call. */
function fakeFetch(replies: Record<string, Reply[]>) {
  const calls: { path: string; headers: Record<string, string> }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, headers: (init?.headers ?? {}) as Record<string, string> });
    const reply = replies[path]?.shift();
    if (!reply) throw new Error(`unexpected request ${path}`);
    if (reply === "throw") throw new TypeError("Failed to fetch");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: reply.headers });
  };
  return { fn, calls };
}

const SESSION = "/api/auth/session";
const USAGE = "/backend-api/wham/usage";
const session = (token = "tok-1", accountId?: string) => ({ status: 200, body: { accessToken: token, ...(accountId ? { account: { id: accountId } } : {}) } });

test("fetches session token once, then usage with bearer + account headers", async () => {
  const f = fakeFetch({ [SESSION]: [session("tok-1", "acct-9")], [USAGE]: [{ status: 200, body: fixture }, { status: 200, body: fixture }] });
  const api = createApi(f.fn);
  assert.equal((await api.fetchUsage()).ok, true);
  assert.equal((await api.fetchUsage()).ok, true);
  assert.equal(f.calls.filter((c) => c.path === SESSION).length, 1, "token is kept in memory");
  const usageCall = f.calls.find((c) => c.path === USAGE)!;
  assert.equal(usageCall.headers.Authorization, "Bearer tok-1");
  assert.equal(usageCall.headers["chatgpt-account-id"], "acct-9");
});

test("401 → token refresh → success", async () => {
  const f = fakeFetch({ [SESSION]: [session("old"), session("new")], [USAGE]: [{ status: 401 }, { status: 200, body: fixture }] });
  const out = await createApi(f.fn).fetchUsage();
  assert.equal(out.ok, true);
  assert.equal(f.calls.filter((c) => c.path === USAGE)[1].headers.Authorization, "Bearer new");
});

test("401 twice → signed out (auth)", async () => {
  const f = fakeFetch({ [SESSION]: [session("a"), session("b")], [USAGE]: [{ status: 401 }, { status: 403 }] });
  assert.deepEqual(await createApi(f.fn).fetchUsage(), { ok: false, kind: "auth" });
});

test("no accessToken in session → auth", async () => {
  const f = fakeFetch({ [SESSION]: [{ status: 200, body: {} }] });
  assert.deepEqual(await createApi(f.fn).fetchUsage(), { ok: false, kind: "auth" });
});

test("429 → rate, with Retry-After", async () => {
  const f = fakeFetch({ [SESSION]: [session()], [USAGE]: [{ status: 429, headers: { "retry-after": "90" } }] });
  assert.deepEqual(await createApi(f.fn).fetchUsage(), { ok: false, kind: "rate", retryAfterMs: 90_000 });
});

test("network failure and server errors → network", async () => {
  const f = fakeFetch({ [SESSION]: [session()], [USAGE]: ["throw", { status: 502 }] });
  const api = createApi(f.fn);
  assert.deepEqual(await api.fetchUsage(), { ok: false, kind: "network" });
  assert.deepEqual(await api.fetchUsage(), { ok: false, kind: "network" });
});

test("unrecognised body → format", async () => {
  const f = fakeFetch({ [SESSION]: [session()], [USAGE]: [{ status: 200, body: { totally: "different" } }] });
  assert.deepEqual(await createApi(f.fn).fetchUsage(), { ok: false, kind: "format" });
});

test("success clears errors, streaks and the lock", () => {
  const failing = { ...EMPTY_CACHE, failStreak: 3, rateStreak: 2, backoffUntil: 5, fetchLock: 1, lastError: { kind: "network" as const, at: 1 } };
  const next = applyOutcome(failing, { ok: true, snapshot: { planType: "plus" } }, 1000);
  assert.deepEqual(next, { snapshot: { planType: "plus" }, fetchedAt: 1000, failStreak: 0, rateStreak: 0, schemaVersion: 1 });
});

test("failures keep the last snapshot and count up", () => {
  const snap = { fiveHour: { usedPercent: 10, windowSeconds: 18000, resetAt: 1 } };
  let c = applyOutcome({ ...EMPTY_CACHE, snapshot: snap, fetchedAt: 1 }, { ok: false, kind: "network" }, 100);
  c = applyOutcome(c, { ok: false, kind: "network" }, 200);
  assert.equal(c.failStreak, 2);
  assert.deepEqual(c.snapshot, snap);
  assert.equal(c.fetchedAt, 1);
  assert.deepEqual(c.lastError, { kind: "network", at: 200 });
});

test("429 backoff: 2, 4, 8, then capped at 10 minutes", () => {
  let c = { ...EMPTY_CACHE };
  const waits: number[] = [];
  for (let i = 0; i < 5; i++) {
    c = applyOutcome(c, { ok: false, kind: "rate" }, 0);
    waits.push(c.backoffUntil! / MIN);
  }
  assert.deepEqual(waits, [2, 4, 8, 10, 10]);
});

test("freshness is measured from the last attempt", () => {
  const c = { ...EMPTY_CACHE, fetchedAt: 0, lastError: { kind: "network" as const, at: 50 * SEC } };
  assert.equal(isFresh(c, 60 * SEC, 100 * SEC), true);
  assert.equal(isFresh(c, 60 * SEC, 111 * SEC), false);
});

test("two tabs: only one gets the fetch lock until it expires", async () => {
  const area = fakeArea();
  await writeCache({ ...EMPTY_CACHE }, area);
  assert.equal(await tryAcquireLock(1_000, area), true);
  assert.equal(await tryAcquireLock(1_500, area), false);
  assert.equal(await tryAcquireLock(1_000 + LOCK_MS + 1, area), true);
  assert.equal((await readCache(area)).fetchLock, 1_000 + LOCK_MS + 1);
});
