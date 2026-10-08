import type { Settings } from "./types";

export const SETTINGS_KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
  showFiveHour: true,
  showWeekly: true,
  showPace: true,
  compact: false,
  display: "used",
  warnAt: 70,
  criticalAt: 90,
  notifyOnReset: false,
  refreshSeconds: 60,
};

const REFRESH_CHOICES = [30, 60, 300] as const;

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** Merges stored values over the defaults, dropping anything invalid. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const s: Settings = {
    showFiveHour: bool(r.showFiveHour, d.showFiveHour),
    showWeekly: bool(r.showWeekly, d.showWeekly),
    showPace: bool(r.showPace, d.showPace),
    compact: bool(r.compact, d.compact),
    display: r.display === "remaining" ? "remaining" : "used",
    warnAt: intIn(r.warnAt, 1, 99, d.warnAt),
    criticalAt: intIn(r.criticalAt, 1, 100, d.criticalAt),
    notifyOnReset: bool(r.notifyOnReset, d.notifyOnReset),
    refreshSeconds: REFRESH_CHOICES.includes(r.refreshSeconds as 30) ? (r.refreshSeconds as Settings["refreshSeconds"]) : d.refreshSeconds,
  };
  if (s.criticalAt <= s.warnAt) {
    s.warnAt = d.warnAt;
    s.criticalAt = d.criticalAt;
  }
  if (!s.showFiveHour && !s.showWeekly) {
    s.showFiveHour = true;
    s.showWeekly = true;
  }
  return s;
}

/** Returns an error message for an invalid threshold pair, or null when it is valid. */
export function validateThresholds(warnAt: number, criticalAt: number): string | null {
  if (!Number.isInteger(warnAt) || warnAt < 1 || warnAt > 99) return "Warn at must be 1–99.";
  if (!Number.isInteger(criticalAt) || criticalAt < 1 || criticalAt > 100) return "Critical at must be 1–100.";
  if (criticalAt <= warnAt) return "Critical must be higher than warn.";
  return null;
}

export async function readSettings(area: chrome.storage.StorageArea = chrome.storage.sync): Promise<Settings> {
  const got = await area.get(SETTINGS_KEY);
  return normalizeSettings(got[SETTINGS_KEY]);
}

export async function writeSettings(patch: Partial<Settings>, area: chrome.storage.StorageArea = chrome.storage.sync): Promise<Settings> {
  const next = normalizeSettings({ ...(await readSettings(area)), ...patch });
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}
