import { readCache } from "../lib/cache";
import { formatUpdatedAgo } from "../lib/format";
import { readPosition, writePosition, type PillPosition } from "../lib/position";
import { readSettings, validateThresholds, writeSettings } from "../lib/settings";
import type { Settings } from "../lib/types";

const form = document.getElementById("form") as HTMLFormElement;
const statusEl = document.getElementById("status") as HTMLElement;
const formatBanner = document.getElementById("format-banner") as HTMLElement;
const thresholdError = document.getElementById("threshold-error") as HTMLElement;

const SWITCHES = ["showFiveHour", "showWeekly", "showPace", "compact", "notifyOnReset"] as const;

function input(name: string): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

function radios(name: string): HTMLInputElement[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`));
}

function fill(s: Settings): void {
  for (const key of SWITCHES) input(key).checked = s[key];
  input("warnAt").value = String(s.warnAt);
  input("criticalAt").value = String(s.criticalAt);
  for (const r of radios("display")) r.checked = r.value === s.display;
  for (const r of radios("refreshSeconds")) r.checked = Number(r.value) === s.refreshSeconds;
  guardLastWindow();
}

/** At least one window stays visible: the last one switched on can't be switched off. */
function guardLastWindow(): void {
  const five = input("showFiveHour");
  const week = input("showWeekly");
  five.disabled = five.checked && !week.checked;
  week.disabled = week.checked && !five.checked;
}

async function onThresholdChange(): Promise<void> {
  const warn = input("warnAt");
  const crit = input("criticalAt");
  const warnAt = Number(warn.value);
  const criticalAt = Number(crit.value);
  const error = validateThresholds(warnAt, criticalAt);
  thresholdError.hidden = !error;
  thresholdError.textContent = error ?? "";
  const pairError = error?.startsWith("Critical must") ?? false;
  warn.setAttribute("aria-invalid", String(pairError || (error?.startsWith("Warn") ?? false)));
  crit.setAttribute("aria-invalid", String(pairError || (error?.startsWith("Critical at") ?? false)));
  if (!error) await writeSettings({ warnAt, criticalAt });
}

async function onNotifyChange(el: HTMLInputElement): Promise<void> {
  if (el.checked) {
    // Must run inside the change event's user gesture.
    const granted = await chrome.permissions.request({ permissions: ["notifications"] });
    if (!granted) {
      el.checked = false;
      return;
    }
  }
  await writeSettings({ notifyOnReset: el.checked });
}

form.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  switch (el.name) {
    case "notifyOnReset":
      void onNotifyChange(el);
      break;
    case "warnAt":
    case "criticalAt":
      void onThresholdChange();
      break;
    case "display":
      void writeSettings({ display: el.value === "remaining" ? "remaining" : "used" });
      break;
    case "refreshSeconds":
      void writeSettings({ refreshSeconds: Number(el.value) as Settings["refreshSeconds"] });
      break;
    default:
      if ((SWITCHES as readonly string[]).includes(el.name)) {
        if (el.name === "showFiveHour" || el.name === "showWeekly") guardLastWindow();
        void writeSettings({ [el.name]: el.checked });
      }
  }
});

form.addEventListener("submit", (e) => e.preventDefault());

const resetPositionBtn = document.getElementById("reset-position") as HTMLButtonElement;
const positionHint = document.getElementById("position-hint") as HTMLElement;

function showPosition(pos: PillPosition | null): void {
  resetPositionBtn.disabled = !pos;
  positionHint.textContent = pos ? "The pill is where you dragged it." : "Drag the pill on chatgpt.com to move it.";
}

resetPositionBtn.addEventListener("click", async () => {
  await writePosition(null); // open chatgpt.com tabs move the pill back right away
  showPosition(null);
});

void readPosition().then(showPosition);

async function showStatus(): Promise<void> {
  const cache = await readCache();
  formatBanner.hidden = cache.lastError?.kind !== "format";
  if (cache.lastError?.kind === "auth") statusEl.textContent = "Signed out of ChatGPT.";
  else if (!cache.fetchedAt) statusEl.textContent = "Open chatgpt.com to load your usage.";
  else {
    const plan = cache.snapshot?.planType;
    statusEl.textContent = `${formatUpdatedAgo(cache.fetchedAt, Date.now())}${plan ? ` · ${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan` : ""}`;
  }
}

void readSettings().then(fill);
void showStatus();
