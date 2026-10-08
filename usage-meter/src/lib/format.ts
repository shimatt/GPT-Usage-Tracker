/** Rounds to a whole percent and clamps to 0–100. Non-numbers become 0. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** "2h 41m", "45m", "3d 4h", "<1m". Rounds up to the next minute so a countdown never shows 0m early. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "<1m";
  const totalMinutes = Math.ceil(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Compact age for chips and "Updated … ago": "12s", "6m", "2h", "3d". */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function formatUpdatedAgo(fetchedAt: number, nowMs: number): string {
  if (!fetchedAt) return "Not updated yet";
  const age = nowMs - fetchedAt;
  return age < 5_000 ? "Updated just now" : `Updated ${formatAge(age)} ago`;
}

/** Reset clock time: "14:20" when it is today, "Tue 14:20" otherwise. */
export function formatResetClock(resetAtSec: number, nowMs: number, locale?: string): string {
  const reset = new Date(resetAtSec * 1000);
  const now = new Date(nowMs);
  const time = reset.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (reset.toDateString() === now.toDateString()) return time;
  const day = reset.toLocaleDateString(locale, { weekday: "short" });
  return `${day} ${time}`;
}
