import { CACHE_KEY, readCache } from "../lib/cache";
import { SETTINGS_KEY, readSettings } from "../lib/settings";
import { WINDOW_KEYS, WINDOW_META, type WindowKey } from "../lib/types";

const ALARM_PREFIX = "reset:";
const MIN_ALARM_DELAY_MS = 30_000; // Chrome's minimum alarm delay
const DUE_SOON_MS = 60_000;
const CHAT_URL = "https://chatgpt.com/";

function hasNotificationPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ["notifications"] });
}

/**
 * Keeps one alarm per window at its reset time while "Notify when a window resets" is on.
 * Windows with 0% used get no alarm: there is nothing to come back.
 */
async function syncAlarms(): Promise<void> {
  const [settings, cache] = await Promise.all([readSettings(), readCache()]);
  const enabled = settings.notifyOnReset && (await hasNotificationPermission());
  const now = Date.now();

  for (const key of WINDOW_KEYS) {
    const name = ALARM_PREFIX + key;
    const existing = await chrome.alarms.get(name);
    // An alarm that is due (or overdue) is left to fire even if a fresher snapshot already rolled over.
    if (enabled && existing && existing.scheduledTime <= now + DUE_SOON_MS) continue;

    const win = cache.snapshot?.[key];
    if (!enabled || !win || win.usedPercent <= 0 || win.resetAt * 1000 <= now) {
      if (existing) await chrome.alarms.clear(name);
      continue;
    }
    const when = Math.max(win.resetAt * 1000, now + MIN_ALARM_DELAY_MS);
    if (existing && Math.abs(existing.scheduledTime - when) < 1_000) continue;
    await chrome.alarms.create(name, { when });
  }
}

async function notifyReset(key: WindowKey): Promise<void> {
  const settings = await readSettings();
  if (!settings.notifyOnReset || !(await hasNotificationPermission())) return;
  const meta = WINDOW_META[key];
  await chrome.notifications.create(`usage-meter:${key}:${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/128.png"),
    title: `${meta.spoken} limit has reset`,
    message: `Your full ${meta.spoken} ChatGPT allowance is available again.`,
    priority: 0,
  });
}

let notificationClickBound = false;
function bindNotificationClick(): void {
  // chrome.notifications only exists once the optional permission is granted.
  if (notificationClickBound || !chrome.notifications?.onClicked) return;
  notificationClickBound = true;
  chrome.notifications.onClicked.addListener((id) => {
    if (!id.startsWith("usage-meter:")) return;
    void chrome.tabs.create({ url: CHAT_URL });
    void chrome.notifications.clear(id);
  });
}

async function openOptions(windowId?: number): Promise<void> {
  try {
    await chrome.action.openPopup(windowId !== undefined ? { windowId } : undefined);
  } catch {
    await chrome.runtime.openOptionsPage();
  }
}

function sameSnapshot(a: unknown, b: unknown): boolean {
  const snap = (v: unknown) => JSON.stringify((v as { snapshot?: unknown } | undefined)?.snapshot ?? null);
  return snap(a) === snap(b);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const key = alarm.name.slice(ALARM_PREFIX.length) as WindowKey;
  if (!(key in WINDOW_META)) return;
  void notifyReset(key).then(syncAlarms);
});

chrome.storage.onChanged.addListener((changes, area) => {
  const cacheChange = area === "local" ? changes[CACHE_KEY] : undefined;
  const snapshotChanged = cacheChange && !sameSnapshot(cacheChange.oldValue, cacheChange.newValue);
  if (snapshotChanged || (area === "sync" && changes[SETTINGS_KEY])) void syncAlarms();
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if ((message as { type?: string } | null)?.type === "open-options") void openOptions(sender.tab?.windowId);
  return false;
});

chrome.permissions.onAdded.addListener(() => {
  bindNotificationClick();
  void syncAlarms();
});
chrome.permissions.onRemoved.addListener(() => void syncAlarms());
chrome.runtime.onInstalled.addListener(() => void syncAlarms());
chrome.runtime.onStartup.addListener(() => void syncAlarms());

bindNotificationClick();
