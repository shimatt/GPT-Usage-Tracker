export type UsageWindow = { usedPercent: number; windowSeconds: number; resetAt: number };

export type Snapshot = { planType?: string; fiveHour?: UsageWindow; weekly?: UsageWindow };

export type ErrorKind = "auth" | "rate" | "network" | "format";

export type Cache = {
  snapshot: Snapshot | null;
  fetchedAt: number; // ms epoch of last successful fetch
  lastError?: { kind: ErrorKind; at: number };
  failStreak: number;
  rateStreak?: number; // consecutive 429s, drives the 2 → 10 min backoff
  backoffUntil?: number; // ms epoch; scheduled fetches wait until then
  fetchLock?: number; // ms epoch; ignored after 10 s
  schemaVersion: 1;
};

export type Settings = {
  showFiveHour: boolean;
  showWeekly: boolean;
  showPace: boolean;
  compact: boolean;
  display: "used" | "remaining";
  warnAt: number;
  criticalAt: number;
  notifyOnReset: boolean;
  refreshSeconds: 30 | 60 | 300;
};

export type WindowKey = "fiveHour" | "weekly";

export const WINDOW_KEYS: readonly WindowKey[] = ["fiveHour", "weekly"];

export const WINDOW_META: Record<WindowKey, { short: string; name: string; spoken: string; seconds: number }> = {
  fiveHour: { short: "5h", name: "5-hour limit", spoken: "5-hour", seconds: 18_000 },
  weekly: { short: "7d", name: "7-day limit", spoken: "7-day", seconds: 604_800 },
};
