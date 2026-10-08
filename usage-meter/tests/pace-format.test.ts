import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPercent, formatAge, formatDuration, formatResetClock, formatUpdatedAgo } from "../src/lib/format";
import { effectiveWindow, elapsedPercent, paceLabel, pacePoints } from "../src/lib/pace";
import type { UsageWindow } from "../src/lib/types";
import { MIN, SEC } from "./helpers";

const RESET = 1_791_450_720; // seconds
const fiveHour = (used: number): UsageWindow => ({ usedPercent: used, windowSeconds: 18_000, resetAt: RESET });
// 2.5 h into a 5 h window → 50% elapsed
const HALFWAY_MS = (RESET - 9_000) * SEC;

test("elapsed percent of the window", () => {
  assert.equal(elapsedPercent(fiveHour(0), HALFWAY_MS), 50);
  assert.equal(elapsedPercent(fiveHour(0), (RESET - 18_000) * SEC), 0);
  assert.equal(elapsedPercent(fiveHour(0), (RESET + 10) * SEC), 100);
});

test("pace labels at −10, 0 and +10 points", () => {
  assert.equal(paceLabel(pacePoints(fiveHour(40), HALFWAY_MS)).label, "Under pace");
  assert.equal(paceLabel(pacePoints(fiveHour(50), HALFWAY_MS)).label, "On pace");
  assert.equal(paceLabel(pacePoints(fiveHour(60), HALFWAY_MS)).label, "Ahead of pace");
});

test("pace band edges: ±5 is on pace", () => {
  assert.equal(paceLabel(-5).label, "On pace");
  assert.equal(paceLabel(5).label, "On pace");
  assert.equal(paceLabel(-5.1).tone, "ok");
  assert.equal(paceLabel(5.1).tone, "warn");
});

test("window rolls over to 0% at reset_at", () => {
  const before = effectiveWindow(fiveHour(80), (RESET - 1) * SEC);
  assert.equal(before.rolledOver, false);
  assert.equal(before.win.usedPercent, 80);

  const after = effectiveWindow(fiveHour(80), RESET * SEC);
  assert.equal(after.rolledOver, true);
  assert.equal(after.win.usedPercent, 0);
  assert.equal(after.win.resetAt, RESET + 18_000);

  const muchLater = effectiveWindow(fiveHour(80), (RESET + 18_000 * 2 + 5) * SEC);
  assert.equal(muchLater.win.resetAt, RESET + 18_000 * 3);
});

test("durations", () => {
  assert.equal(formatDuration(30), "<1m");
  assert.equal(formatDuration(45 * 60), "45m");
  assert.equal(formatDuration(2 * 3600 + 41 * 60), "2h 41m");
  assert.equal(formatDuration(2 * 3600 + 40 * 60 + 1), "2h 41m"); // rounds up
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(3 * 86400 + 4 * 3600), "3d 4h");
});

test("ages and 'Updated … ago'", () => {
  assert.equal(formatAge(12 * SEC), "12s");
  assert.equal(formatAge(6 * MIN), "6m");
  assert.equal(formatAge(3 * 60 * MIN), "3h");
  assert.equal(formatUpdatedAgo(0, 1e12), "Not updated yet");
  assert.equal(formatUpdatedAgo(1e12, 1e12 + 2 * SEC), "Updated just now");
  assert.equal(formatUpdatedAgo(1e12, 1e12 + 12 * SEC), "Updated 12s ago");
});

test("reset clock shows the weekday only when not today (TZ=UTC)", () => {
  const reset = Date.UTC(2026, 9, 6, 14, 20) / 1000; // Tue 6 Oct 2026, 14:20 UTC
  assert.equal(formatResetClock(reset, Date.UTC(2026, 9, 6, 9, 0), "en-GB"), "14:20");
  assert.equal(formatResetClock(reset, Date.UTC(2026, 9, 4, 9, 0), "en-GB"), "Tue 14:20");
});

test("clampPercent", () => {
  assert.equal(clampPercent(38.4), 38);
  assert.equal(clampPercent(140), 100);
  assert.equal(clampPercent(-1), 0);
  assert.equal(clampPercent(Number.NaN), 0);
});
