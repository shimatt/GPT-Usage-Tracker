import { WINDOW_META, type Snapshot, type UsageWindow, type WindowKey } from "./types";
import { clampPercent } from "./format";

const TOLERANCE_SECONDS = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function windowKeyFor(seconds: number): WindowKey | undefined {
  for (const key of Object.keys(WINDOW_META) as WindowKey[]) {
    if (Math.abs(seconds - WINDOW_META[key].seconds) <= TOLERANCE_SECONDS) return key;
  }
  return undefined;
}

function parseWindow(raw: unknown, nowMs: number): UsageWindow | undefined {
  if (!isRecord(raw)) return undefined;
  const used = finite(raw.used_percent);
  const windowSeconds = finite(raw.limit_window_seconds);
  if (used === undefined || windowSeconds === undefined) return undefined;

  let resetAt = finite(raw.reset_at);
  // Defensive: some builds of the endpoint send a relative reset instead.
  if (resetAt === undefined) {
    const after = finite(raw.reset_after_seconds);
    if (after !== undefined) resetAt = Math.round(nowMs / 1000 + after);
  }
  if (resetAt === undefined) return undefined;

  return { usedPercent: clampPercent(used), windowSeconds, resetAt };
}

/**
 * Turns a `wham/usage` response into a Snapshot. Windows are matched by their length, not by
 * the primary/secondary field names. Returns null when no known window is found, which the
 * caller treats as "usage format changed".
 */
export function parseUsage(json: unknown, nowMs = Date.now()): Snapshot | null {
  if (!isRecord(json) || !isRecord(json.rate_limit)) return null;

  const snapshot: Snapshot = {};
  for (const candidate of Object.values(json.rate_limit)) {
    const win = parseWindow(candidate, nowMs);
    if (!win) continue;
    const key = windowKeyFor(win.windowSeconds);
    if (key && !snapshot[key]) snapshot[key] = win;
  }

  if (!snapshot.fiveHour && !snapshot.weekly) return null;
  if (typeof json.plan_type === "string" && json.plan_type) snapshot.planType = json.plan_type;
  return snapshot;
}
