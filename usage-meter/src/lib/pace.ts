import type { UsageWindow } from "./types";

export type PaceLabel = "Under pace" | "On pace" | "Ahead of pace";
export type PaceTone = "ok" | "muted" | "warn";

const ON_PACE_BAND = 5;

/**
 * Returns the window as it should be shown at `nowMs`. Once `reset_at` has passed the window
 * counts as fresh: 0% used, next reset one window later. `rolledOver` tells the caller to fetch.
 */
export function effectiveWindow(win: UsageWindow, nowMs: number): { win: UsageWindow; rolledOver: boolean } {
  const nowSec = nowMs / 1000;
  if (nowSec < win.resetAt) return { win, rolledOver: false };
  const periods = Math.floor((nowSec - win.resetAt) / win.windowSeconds) + 1;
  return {
    win: { ...win, usedPercent: 0, resetAt: win.resetAt + periods * win.windowSeconds },
    rolledOver: true,
  };
}

/** Percent of the window's time that has passed, 0–100. */
export function elapsedPercent(win: UsageWindow, nowMs: number): number {
  if (win.windowSeconds <= 0) return 0;
  const start = win.resetAt - win.windowSeconds;
  const pct = ((nowMs / 1000 - start) / win.windowSeconds) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Seconds until the window resets, never negative. */
export function secondsUntilReset(win: UsageWindow, nowMs: number): number {
  return Math.max(0, win.resetAt - nowMs / 1000);
}

/** used% − elapsed%, in percentage points. Positive means using faster than time passes. */
export function pacePoints(win: UsageWindow, nowMs: number): number {
  return win.usedPercent - elapsedPercent(win, nowMs);
}

export function paceLabel(points: number): { label: PaceLabel; tone: PaceTone } {
  if (points < -ON_PACE_BAND) return { label: "Under pace", tone: "ok" };
  if (points > ON_PACE_BAND) return { label: "Ahead of pace", tone: "warn" };
  return { label: "On pace", tone: "muted" };
}
