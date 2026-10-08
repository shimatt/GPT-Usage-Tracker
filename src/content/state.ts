import { formatAge, formatDuration, formatResetClock, formatUpdatedAgo } from "../lib/format";
import { effectiveWindow, elapsedPercent, paceLabel, pacePoints, secondsUntilReset, type PaceLabel, type PaceTone } from "../lib/pace";
import { WINDOW_KEYS, WINDOW_META, type Cache, type Settings, type WindowKey } from "../lib/types";

export type Level = "normal" | "warning" | "critical" | "limit";

const LEVEL_RANK: Record<Level, number> = { normal: 0, warning: 1, critical: 2, limit: 3 };
const VISIBLE_GRACE_MS = 15_000;

export type WindowView = {
  key: WindowKey;
  short: string;
  name: string;
  missing: boolean;
  used: number;
  shown: number; // used or remaining, per settings.display
  level: Level;
  resetIn: string;
  resetClock: string;
  elapsed: number;
  tick: number; // pace tick position on a bar that fills with `shown`
  pace: { label: PaceLabel; tone: PaceTone; points: number };
  rolledOver: boolean;
  resetAt: number;
};

export type View = {
  kind: "signedOut" | "loading" | "data";
  level: Level;
  stale: boolean;
  staleAge: string;
  formatChanged: boolean;
  windows: WindowView[];
  planType?: string;
  updatedAgo: string;
  ariaLabel: string;
  tooltip: string;
  rolledOver: boolean;
};

export type ViewContext = { visibleSince: number };

export function levelFor(used: number, settings: Settings): Level {
  if (used >= 100) return "limit";
  if (used >= settings.criticalAt) return "critical";
  if (used >= settings.warnAt) return "warning";
  return "normal";
}

function windowView(key: WindowKey, cache: Cache, settings: Settings, nowMs: number): WindowView {
  const meta = WINDOW_META[key];
  const raw = cache.snapshot?.[key];
  const remaining = settings.display === "remaining";
  if (!raw) {
    return {
      key, short: meta.short, name: meta.name, missing: true, used: 0, shown: 0, level: "normal",
      resetIn: "", resetClock: "", elapsed: 0, tick: 0,
      pace: { label: "On pace", tone: "muted", points: 0 }, rolledOver: false, resetAt: 0,
    };
  }
  const { win, rolledOver } = effectiveWindow(raw, nowMs);
  const elapsed = elapsedPercent(win, nowMs);
  const points = pacePoints(win, nowMs);
  return {
    key,
    short: meta.short,
    name: meta.name,
    missing: false,
    used: win.usedPercent,
    shown: remaining ? 100 - win.usedPercent : win.usedPercent,
    level: levelFor(win.usedPercent, settings),
    resetIn: formatDuration(secondsUntilReset(win, nowMs)),
    resetClock: formatResetClock(win.resetAt, nowMs),
    elapsed,
    tick: remaining ? 100 - elapsed : elapsed,
    pace: { ...paceLabel(points), points },
    rolledOver,
    resetAt: win.resetAt,
  };
}

function valueWords(w: WindowView, settings: Settings): string {
  if (w.missing) return `${WINDOW_META[w.key].spoken} unavailable`;
  return `${WINDOW_META[w.key].spoken} ${w.shown}% ${settings.display === "remaining" ? "left" : "used"}`;
}

export function deriveView(cache: Cache, settings: Settings, nowMs: number, ctx: ViewContext): View {
  const keys = WINDOW_KEYS.filter((k) => (k === "fiveHour" ? settings.showFiveHour : settings.showWeekly));
  const windows = keys.map((k) => windowView(k, cache, settings, nowMs));
  const level = windows.reduce<Level>((worst, w) => (LEVEL_RANK[w.level] > LEVEL_RANK[worst] ? w.level : worst), "normal");

  const intervalMs = settings.refreshSeconds * 1000;
  const age = cache.fetchedAt ? nowMs - cache.fetchedAt : Infinity;
  const formatChanged = cache.lastError?.kind === "format";
  const tooOld = age > 3 * intervalMs && (cache.failStreak >= 1 || nowMs - ctx.visibleSince > VISIBLE_GRACE_MS);
  const stale = cache.failStreak >= 2 || formatChanged || tooOld;
  const staleAge = cache.fetchedAt ? `${formatAge(age)} old` : "no data";

  let kind: View["kind"] = "data";
  if (cache.lastError?.kind === "auth") kind = "signedOut";
  else if (!cache.snapshot && !stale) kind = "loading";

  let ariaLabel: string;
  if (kind === "signedOut") ariaLabel = "Usage: sign in to see usage";
  else if (kind === "loading") ariaLabel = "Usage: loading";
  else {
    ariaLabel = `Usage: ${windows.map((w) => valueWords(w, settings)).join(", ")}`;
    const limited = windows.filter((w) => w.level === "limit");
    if (limited.length) ariaLabel += `. ${limited.map((w) => `${WINDOW_META[w.key].spoken} limit reached, back in ${w.resetIn}`).join(". ")}`;
    else if (level === "critical") ariaLabel += ". Critical";
    else if (level === "warning") ariaLabel += ". Warning";
    if (stale) ariaLabel += `. Couldn't refresh, data ${staleAge}`;
  }

  const tooltip = kind === "data" ? windows.map((w) => `${w.short} ${w.missing ? "—" : `${w.shown}%`}`).join(" · ") : "";

  return {
    kind,
    level: kind === "data" ? level : "normal",
    stale: kind === "data" && stale,
    staleAge,
    formatChanged,
    windows,
    planType: cache.snapshot?.planType,
    updatedAgo: formatUpdatedAgo(cache.fetchedAt, nowMs),
    ariaLabel,
    tooltip,
    rolledOver: windows.some((w) => w.rolledOver),
  };
}
