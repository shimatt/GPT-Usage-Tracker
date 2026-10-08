import { ORIGIN } from "../lib/api";
import type { Settings } from "../lib/types";
import { h, icons } from "./dom";
import type { Level, View, WindowView } from "./state";

/** ChatGPT's own usage page. Kept in one place because the URL is not documented. */
export const USAGE_SETTINGS_URL = `${ORIGIN}/codex/settings/usage`;

const LEVEL_CHIP: Partial<Record<Level, string>> = { warning: "Warning", critical: "Critical", limit: "Limit reached" };

export type PopoverHandlers = { onRefresh: () => void; onOptions: () => void };

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function windowSection(w: WindowView, view: View, settings: Settings): HTMLElement {
  const unit = settings.display === "remaining" ? "left" : "used";
  const chip = LEVEL_CHIP[w.level];
  const head = h(
    "div",
    { class: "win-head" },
    h("span", { class: "win-name" }, w.name),
    chip && h("span", { class: `chip level-${w.level}` }, w.level !== "warning" ? icons.warning() : null, chip),
  );

  if (view.kind === "loading") {
    return h("section", { class: "win-detail" }, head, h("div", { class: "bigbar skeleton" }), h("div", { class: "win-foot muted" }, "Loading…"));
  }
  if (w.missing) {
    return h(
      "section",
      { class: "win-detail" },
      head,
      h("div", { class: "win-main" }, h("span", { class: "big muted" }, "—")),
      h("div", { class: "win-foot muted" }, "No data for this window"),
    );
  }

  const resetText = w.level === "limit" ? `back in ${w.resetIn}` : `resets in ${w.resetIn}`;
  const bar = h(
    "div",
    { class: `bigbar level-${w.level}` },
    h("span", { class: "fill", style: { width: `${w.shown}%` } }),
    settings.showPace && h("span", { class: "tick", style: { left: `${w.tick}%` }, title: `${Math.round(w.elapsed)}% of window elapsed` }),
  );

  return h(
    "section",
    { class: `win-detail level-${w.level}` },
    head,
    h(
      "div",
      { class: "win-main" },
      h("span", { class: "big" }, `${w.shown}%`, h("span", { class: "big-unit" }, unit)),
      h("span", { class: "reset-block" }, h("span", { class: "reset-in" }, resetText), h("span", { class: "reset-clock" }, w.resetClock)),
    ),
    bar,
    h(
      "div",
      { class: "win-foot" },
      h("span", { class: "muted" }, `${Math.round(w.elapsed)}% of window elapsed`),
      settings.showPace && h("span", { class: `pace tone-${w.pace.tone}` }, w.pace.label),
    ),
  );
}

function notice(view: View): HTMLElement | null {
  if (view.kind === "signedOut") return h("div", { class: "notice" }, "Sign in to ChatGPT to see your usage.");
  if (view.formatChanged) return h("div", { class: "notice warn" }, "Usage format changed — update the extension.");
  if (view.stale) return h("div", { class: "notice warn" }, `Couldn't refresh · last data ${view.staleAge}.`);
  return null;
}

export function renderPopover(container: HTMLElement, view: View, settings: Settings, fetching: boolean, handlers: PopoverHandlers): void {
  const refresh = h(
    "button",
    {
      type: "button",
      class: `icon-btn${fetching ? " spinning" : ""}`,
      "aria-label": fetching ? "Refreshing usage" : "Refresh usage",
      title: "Refresh",
      "data-focus-key": "refresh",
      onClick: handlers.onRefresh,
    },
    icons.refresh(),
  );

  const header = h(
    "header",
    { class: "pop-head" },
    h("div", { class: "pop-title" }, h("h2", {}, "Usage"), view.planType && h("span", { class: "plan" }, capitalize(view.planType))),
    h("div", { class: "pop-meta" }, h("span", { class: "updated", "aria-live": "polite" }, view.kind === "loading" ? "Loading…" : view.updatedAgo), refresh),
  );

  const body = view.kind === "signedOut" ? [] : view.windows.map((w) => windowSection(w, view, settings));

  const footer = h(
    "footer",
    { class: "pop-foot" },
    h("a", { href: USAGE_SETTINGS_URL, target: "_blank", rel: "noopener noreferrer", "data-focus-key": "usage-link" }, "Open usage settings", icons.external()),
    h("button", { type: "button", class: "text-btn", "data-focus-key": "options", onClick: handlers.onOptions }, icons.settings(), "Options"),
  );

  container.replaceChildren(header, ...[notice(view)].filter((n): n is HTMLElement => n !== null), ...body, footer);
}
