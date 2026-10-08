import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveView } from "../src/content/state";
import { EMPTY_CACHE } from "../src/lib/cache";
import { DEFAULT_SETTINGS, normalizeSettings, validateThresholds } from "../src/lib/settings";
import type { Cache, Settings } from "../src/lib/types";
import { MIN, SEC } from "./helpers";

const NOW = 1_800_000_000_000;
const resetIn = (seconds: number) => Math.round(NOW / 1000 + seconds);

function cacheWith(five: number, week: number, extra: Partial<Cache> = {}): Cache {
  return {
    ...EMPTY_CACHE,
    fetchedAt: NOW - 10 * SEC,
    snapshot: {
      planType: "plus",
      fiveHour: { usedPercent: five, windowSeconds: 18_000, resetAt: resetIn(2 * 3600 + 41 * 60) },
      weekly: { usedPercent: week, windowSeconds: 604_800, resetAt: resetIn(3 * 86400) },
    },
    ...extra,
  };
}

const view = (cache: Cache, settings: Partial<Settings> = {}, visibleSince = NOW - 60 * SEC) =>
  deriveView(cache, { ...DEFAULT_SETTINGS, ...settings }, NOW, { visibleSince });

test("normal: aria-label reads both values", () => {
  const v = view(cacheWith(38, 50));
  assert.equal(v.kind, "data");
  assert.equal(v.level, "normal");
  assert.equal(v.ariaLabel, "Usage: 5-hour 38% used, 7-day 50% used");
});

test("worst window decides the pill level", () => {
  assert.equal(view(cacheWith(38, 71)).level, "warning");
  assert.equal(view(cacheWith(92, 71)).level, "critical");
  assert.equal(view(cacheWith(100, 10)).level, "limit");
  assert.match(view(cacheWith(100, 10)).ariaLabel, /5-hour limit reached, back in 2h 41m/);
});

test("thresholds come from settings", () => {
  assert.equal(view(cacheWith(60, 0), { warnAt: 50, criticalAt: 60 }).level, "critical");
});

test("remaining display flips values and the pace tick", () => {
  const v = view(cacheWith(38, 71), { display: "remaining" });
  assert.equal(v.windows[0].shown, 62);
  assert.equal(v.ariaLabel, "Usage: 5-hour 62% left, 7-day 29% left. Warning");
  assert.ok(Math.abs(v.windows[0].tick - (100 - v.windows[0].elapsed)) < 1e-9);
});

test("hidden windows are left out", () => {
  const v = view(cacheWith(38, 71), { showWeekly: false });
  assert.deepEqual(v.windows.map((w) => w.key), ["fiveHour"]);
  assert.equal(v.level, "normal");
});

test("missing window renders as — and does not hide the pill", () => {
  const c = cacheWith(38, 71);
  delete c.snapshot!.weekly;
  const v = view(c);
  assert.equal(v.windows[1].missing, true);
  assert.equal(v.ariaLabel, "Usage: 5-hour 38% used, 7-day unavailable");
});

test("loading, signed out", () => {
  assert.equal(view({ ...EMPTY_CACHE }, {}, NOW).kind, "loading");
  assert.equal(view(cacheWith(1, 1, { lastError: { kind: "auth", at: NOW } })).kind, "signedOut");
});

test("couldn't refresh after 2 failures in a row, keeping values", () => {
  const v = view(cacheWith(38, 71, { failStreak: 2, fetchedAt: NOW - 6 * MIN }));
  assert.equal(v.stale, true);
  assert.equal(v.staleAge, "6m old");
  assert.equal(v.level, "warning");
  assert.equal(v.windows[0].shown, 38);
});

test("old data is stale only after the visible grace period or a failure", () => {
  const old = cacheWith(38, 71, { fetchedAt: NOW - 10 * MIN });
  assert.equal(view(old, {}, NOW - 2 * SEC).stale, false, "just refocused: refetch in flight");
  assert.equal(view(old, {}, NOW - 20 * SEC).stale, true);
  assert.equal(view({ ...old, failStreak: 1 }, {}, NOW - 2 * SEC).stale, true);
});

test("format change shows couldn't refresh", () => {
  const v = view(cacheWith(38, 71, { failStreak: 1, lastError: { kind: "format", at: NOW } }));
  assert.equal(v.stale, true);
  assert.equal(v.formatChanged, true);
});

test("countdown passes reset_at → 0% and rolledOver", () => {
  const c = cacheWith(95, 10);
  c.snapshot!.fiveHour!.resetAt = resetIn(-1);
  const v = view(c);
  assert.equal(v.windows[0].used, 0);
  assert.equal(v.rolledOver, true);
  assert.equal(v.level, "normal");
});

test("settings: invalid values fall back to defaults", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  const s = normalizeSettings({ warnAt: 0, criticalAt: 200, refreshSeconds: 15, display: "x", compact: "yes" });
  assert.equal(s.warnAt, 70);
  assert.equal(s.criticalAt, 90);
  assert.equal(s.refreshSeconds, 60);
  assert.equal(s.display, "used");
  assert.equal(s.compact, false);
  assert.deepEqual(normalizeSettings({ warnAt: 80, criticalAt: 80 }), DEFAULT_SETTINGS);
  const both = normalizeSettings({ showFiveHour: false, showWeekly: false });
  assert.equal(both.showFiveHour && both.showWeekly, true);
});

test("threshold validation", () => {
  assert.equal(validateThresholds(70, 90), null);
  assert.match(validateThresholds(90, 90)!, /higher/);
  assert.match(validateThresholds(0, 90)!, /Warn/);
  assert.match(validateThresholds(70, 101)!, /Critical at/);
});
