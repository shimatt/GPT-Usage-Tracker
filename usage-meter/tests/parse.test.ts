import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "../fixtures/usage.json";
import { parseUsage } from "../src/lib/parse";

test("parses the fixture into both windows", () => {
  assert.deepEqual(parseUsage(fixture), {
    planType: "plus",
    fiveHour: { usedPercent: 38, windowSeconds: 18000, resetAt: 1791450720 },
    weekly: { usedPercent: 71, windowSeconds: 604800, resetAt: 1791814800 },
  });
});

test("matches windows by length, not by primary/secondary", () => {
  const swapped = {
    rate_limit: {
      primary_window: fixture.rate_limit.secondary_window,
      secondary_window: fixture.rate_limit.primary_window,
    },
  };
  const s = parseUsage(swapped);
  assert.equal(s?.fiveHour?.usedPercent, 38);
  assert.equal(s?.weekly?.usedPercent, 71);
});

test("a missing window is left out, the other still parses", () => {
  const s = parseUsage({ rate_limit: { primary_window: fixture.rate_limit.primary_window, secondary_window: null } });
  assert.ok(s?.fiveHour);
  assert.equal(s?.weekly, undefined);
});

test("ignores extra fields", () => {
  const s = parseUsage({
    ...fixture,
    credits: { balance: 3 },
    rate_limit: { ...fixture.rate_limit, allowed: true, limit_reached: false, code_review_window: { foo: 1 } },
  });
  assert.equal(s?.fiveHour?.usedPercent, 38);
  assert.equal(s?.weekly?.usedPercent, 71);
});

test("clamps used_percent above 100 and below 0", () => {
  const s = parseUsage({
    rate_limit: {
      primary_window: { used_percent: 140, limit_window_seconds: 18000, reset_at: 1 },
      secondary_window: { used_percent: -3, limit_window_seconds: 604800, reset_at: 1 },
    },
  });
  assert.equal(s?.fiveHour?.usedPercent, 100);
  assert.equal(s?.weekly?.usedPercent, 0);
});

test("window length tolerance is ±120 s", () => {
  const win = (seconds: number) => ({ rate_limit: { w: { used_percent: 1, limit_window_seconds: seconds, reset_at: 1 } } });
  assert.ok(parseUsage(win(18_120))?.fiveHour);
  assert.ok(parseUsage(win(604_680))?.weekly);
  assert.equal(parseUsage(win(18_121)), null);
});

test("returns null when the shape is unrecognisable", () => {
  assert.equal(parseUsage(null), null);
  assert.equal(parseUsage("nope"), null);
  assert.equal(parseUsage({}), null);
  assert.equal(parseUsage({ rate_limit: { primary_window: { used: 3 } } }), null);
  assert.equal(parseUsage({ rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 3600, reset_at: 1 } } }), null);
});
