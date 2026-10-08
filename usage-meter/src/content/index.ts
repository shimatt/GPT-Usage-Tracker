import { createApi } from "../lib/api";
import { CACHE_KEY, EMPTY_CACHE, applyOutcome, isFresh, isLocked, normalizeCache, readCache, tryAcquireLock, writeCache } from "../lib/cache";
import { formatUpdatedAgo } from "../lib/format";
import { POSITION_KEY, clampPosition, normalizePosition, readPosition, writePosition, type PillPosition } from "../lib/position";
import { DEFAULT_SETTINGS, SETTINGS_KEY, normalizeSettings, readSettings } from "../lib/settings";
import { WINDOW_KEYS, type Cache, type Settings } from "../lib/types";
import { h } from "./dom";
import { renderPill } from "./pill";
import { renderPopover } from "./popover";
import { deriveView } from "./state";
import css from "./styles.css";

const HOST_ID = "usage-meter-root";
const POPOVER_HOST_ID = "usage-meter-popover-root";

/**
 * Where the pill goes, tried in order. ChatGPT's markup changes often, so this is the one place
 * to update. `before` inserts the pill in front of the match; `prepend` puts it first inside it.
 */
const ANCHOR_SELECTORS: ReadonlyArray<{ selector: string; where: "before" | "prepend" }> = [
  { selector: '#page-header [data-testid="profile-button"]', where: "before" },
  { selector: 'header [data-testid="profile-button"]', where: "before" },
  { selector: 'header button[aria-label="Open Profile Menu"]', where: "before" },
  { selector: "#conversation-header-actions", where: "prepend" },
  { selector: '#page-header [data-testid="share-chat-button"]', where: "before" },
];

const FALLBACK_AFTER_MS = 3_000;
const OBSERVER_THROTTLE_MS = 500;
const SCHEDULER_TICK_MS = 5_000;
const RENDER_TICK_MS = 30_000;
const FOCUS_REFRESH_MS = 15_000;
const MANUAL_DEBOUNCE_MS = 5_000;
const POPOVER_GAP_PX = 8;
const DRAG_THRESHOLD_PX = 4;
const HOST_Z_INDEX = "2147482000";

if (!document.getElementById(HOST_ID)) start();

function start(): void {
  const api = createApi();

  let cache: Cache = { ...EMPTY_CACHE };
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let open = false;
  let fetching = false;
  let visibleSince = Date.now();
  let lastManualAt = 0;
  let fallbackAllowed = false;
  let mode: "none" | "anchored" | "fallback" | "dragged" = "none";
  let position: PillPosition | null = null;
  let dragging = false;
  const rolloversFetched = new Set<string>();
  const timers: number[] = [];

  // ───────── DOM ─────────

  const host = h("div", { id: HOST_ID });
  const shadow = host.attachShadow({ mode: "open" });
  const pill = h("button", { type: "button", class: "pill", "aria-haspopup": "dialog" });
  shadow.append(h("style", {}, css), pill);

  // The popover lives in its own host on <body> so a transformed or clipped header can't trap it.
  const popHost = h("div", { id: POPOVER_HOST_ID });
  const popShadow = popHost.attachShadow({ mode: "open" });
  const popover = h("div", { class: "popover", role: "dialog", "aria-label": "Usage details", tabindex: "-1", hidden: true });
  popShadow.append(h("style", {}, css), popover);

  // ───────── Mounting ─────────

  function findAnchor(): { el: Element; where: "before" | "prepend" } | null {
    for (const { selector, where } of ANCHOR_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) {
        if (el.getClientRects().length > 0) return { el, where };
      }
    }
    return null;
  }

  /** Pins the pill where the user dropped it, on <body>, clamped into the viewport. */
  function applyPosition(pos: PillPosition): void {
    const rect = host.getBoundingClientRect();
    const size = { width: rect.width || 200, height: rect.height || 36 };
    const p = clampPosition(pos, size, { width: window.innerWidth, height: window.innerHeight });
    Object.assign(host.style, { position: "fixed", top: `${p.top}px`, right: `${p.right}px`, left: "auto", zIndex: HOST_Z_INDEX });
    if (host.parentElement !== document.body) document.body.append(host);
    mode = "dragged";
  }

  /** Back to the automatic spot (top bar, or the fixed fallback). */
  function resetPlacement(): void {
    host.removeAttribute("style");
    host.remove();
    mode = "none";
    ensureMounted();
  }

  function ensureMounted(): void {
    if (dragging) return;
    if (!popHost.isConnected) document.body.append(popHost);
    if (position) {
      applyPosition(position);
      if (open) positionPopover();
      return;
    }
    const anchor = findAnchor();
    if (anchor) {
      const placed = anchor.where === "before" ? host.nextElementSibling === anchor.el : anchor.el.firstElementChild === host;
      if (!placed) {
        host.removeAttribute("style");
        if (anchor.where === "before") anchor.el.before(host);
        else anchor.el.prepend(host);
      }
      mode = "anchored";
    } else if (!host.isConnected && fallbackAllowed) {
      Object.assign(host.style, { position: "fixed", top: "10px", right: "64px", zIndex: HOST_Z_INDEX });
      document.body.append(host);
      mode = "fallback";
    }
    if (open) positionPopover();
  }

  let observerTimer = 0;
  const pageObserver = new MutationObserver(() => {
    if (observerTimer) return;
    observerTimer = window.setTimeout(() => {
      observerTimer = 0;
      ensureMounted();
    }, OBSERVER_THROTTLE_MS);
  });

  // ───────── Theme ─────────

  function applyTheme(): void {
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    host.dataset.theme = theme;
    popHost.dataset.theme = theme;
  }
  const themeObserver = new MutationObserver(applyTheme);

  // ───────── Rendering ─────────

  /** Right-aligned under the pill; flips above it or shifts sideways when the pill was dragged near an edge. */
  function positionPopover(): void {
    const r = pill.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const left = Math.min(Math.max(POPOVER_GAP_PX, r.right - width), window.innerWidth - width - POPOVER_GAP_PX);
    let top = r.bottom + POPOVER_GAP_PX;
    if (top + height > window.innerHeight - POPOVER_GAP_PX && r.top - POPOVER_GAP_PX - height >= POPOVER_GAP_PX) {
      top = r.top - POPOVER_GAP_PX - height;
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function render(): void {
    const now = Date.now();
    const view = deriveView(cache, settings, now, { visibleSince });
    renderPill(pill, view, settings, open);
    if (open) {
      const focusKey = (popShadow.activeElement as HTMLElement | null)?.dataset.focusKey;
      renderPopover(popover, view, settings, fetching, { onRefresh: manualRefresh, onOptions: openOptions });
      if (focusKey) popShadow.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
      positionPopover();
    }
    checkRollover(now);
  }

  /** When a window's reset time passes, the view already shows 0%; fetch right away to confirm. */
  function checkRollover(now: number): void {
    const snap = cache.snapshot;
    if (!snap || document.visibilityState !== "visible") return;
    for (const key of WINDOW_KEYS) {
      const win = snap[key];
      if (!win || now / 1000 < win.resetAt) continue;
      const id = `${key}:${win.resetAt}`;
      if (rolloversFetched.has(id)) continue;
      rolloversFetched.add(id);
      void maybeFetch({ force: true });
    }
  }

  // ───────── Fetching ─────────

  async function maybeFetch(opts: { maxAgeMs?: number; force?: boolean }): Promise<void> {
    if (fetching) return;
    fetching = true;
    let acquired = false;
    try {
      const now = Date.now();
      cache = await readCache();
      if (!opts.force) {
        if (isFresh(cache, opts.maxAgeMs ?? settings.refreshSeconds * 1000, now)) return;
        if (cache.backoffUntil && now < cache.backoffUntil) return;
      }
      if (isLocked(cache, now)) return;
      acquired = await tryAcquireLock(now);
      if (!acquired) return;
      if (open) render(); // show the spinner

      const outcome = await api.fetchUsage();
      const next = applyOutcome(await readCache(), outcome, Date.now());
      cache = next;
      await writeCache(next);
    } catch (err) {
      if (contextInvalidated()) teardown();
      else console.debug("[Usage Meter] fetch cycle failed", err);
    } finally {
      fetching = false;
      if (acquired && host.isConnected) render();
    }
  }

  function manualRefresh(): void {
    const now = Date.now();
    if (now - lastManualAt < MANUAL_DEBOUNCE_MS) return;
    lastManualAt = now;
    void maybeFetch({ force: true });
  }

  function schedulerTick(): void {
    if (contextInvalidated()) return teardown();
    if (document.visibilityState !== "visible") return;
    if (cache.lastError?.kind === "auth") return; // signed out: retry on next focus instead
    void maybeFetch({});
  }

  function onRegainFocus(): void {
    if (document.visibilityState !== "visible") return;
    void maybeFetch({ maxAgeMs: FOCUS_REFRESH_MS });
  }

  // ───────── Popover ─────────

  function setOpen(next: boolean, returnFocus = false): void {
    if (open === next) return;
    open = next;
    popover.hidden = !open;
    if (open) {
      render();
      popover.focus({ preventScroll: true });
      void maybeFetch({ maxAgeMs: FOCUS_REFRESH_MS });
      startUpdatedTicker();
    } else {
      stopUpdatedTicker();
      render();
      if (returnFocus) pill.focus({ preventScroll: true });
    }
  }

  // "Updated Ns ago" changes every second while the popover is visible; only that text is touched.
  let updatedTicker = 0;
  function startUpdatedTicker(): void {
    stopUpdatedTicker();
    updatedTicker = window.setInterval(() => {
      const el = popShadow.querySelector(".updated");
      if (el && cache.snapshot && !fetching) el.textContent = formatUpdatedAgo(cache.fetchedAt, Date.now());
    }, 1_000);
  }
  function stopUpdatedTicker(): void {
    if (updatedTicker) window.clearInterval(updatedTicker);
    updatedTicker = 0;
  }

  function openOptions(): void {
    setOpen(false, true);
    chrome.runtime.sendMessage({ type: "open-options" }).catch(() => undefined);
  }

  // A drag ends with a click on the pill; that click must not toggle the popover.
  let suppressClick = false;

  pill.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (pill.classList.contains("stale")) manualRefresh();
    setOpen(!open, true);
  });

  // ───────── Dragging ─────────

  let press: { id: number; x: number; y: number; left: number; top: number; width: number; height: number } | null = null;

  pill.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || press) return;
    const r = host.getBoundingClientRect();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, width: r.width, height: r.height };
    // Window-level listeners keep working while the host is moved to <body> mid-drag.
    window.addEventListener("pointermove", onDragMove, true);
    window.addEventListener("pointerup", onDragEnd, true);
    window.addEventListener("pointercancel", onDragEnd, true);
  });

  function onDragMove(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      setOpen(false);
      host.dataset.dragging = "";
      Object.assign(host.style, { position: "fixed", left: `${press.left}px`, top: `${press.top}px`, right: "auto", zIndex: HOST_Z_INDEX });
      if (host.parentElement !== document.body) document.body.append(host);
    }
    e.preventDefault();
    const left = Math.min(Math.max(0, press.left + dx), window.innerWidth - press.width);
    const top = Math.min(Math.max(0, press.top + dy), window.innerHeight - press.height);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }

  function onDragEnd(e: PointerEvent): void {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", onDragEnd, true);
    window.removeEventListener("pointercancel", onDragEnd, true);
    if (!dragging) return;

    dragging = false;
    delete host.dataset.dragging;
    const r = host.getBoundingClientRect();
    position = { top: Math.round(r.top), right: Math.round(window.innerWidth - r.right) };
    applyPosition(position);
    void writePosition(position).catch(() => undefined);
    if (e.type === "pointerup") {
      suppressClick = true;
      // If the pointer was released off the pill no click follows; don't swallow the next real one.
      window.setTimeout(() => (suppressClick = false), 0);
    }
  }

  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    setOpen(false, true);
  };
  popover.addEventListener("keydown", onEscape);
  pill.addEventListener("keydown", onEscape);

  const onDocKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && open) setOpen(false);
  };
  const onDocPointerDown = (e: PointerEvent): void => {
    if (!open) return;
    const path = e.composedPath();
    if (path.includes(host) || path.includes(popHost)) return;
    setOpen(false);
  };
  const onViewportChange = (): void => {
    if (open) positionPopover();
  };
  const onResize = (): void => {
    if (position && !dragging) applyPosition(position);
    onViewportChange();
  };

  // ───────── Storage sync ─────────

  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area === "local" && changes[CACHE_KEY]) {
      cache = normalizeCache(changes[CACHE_KEY].newValue);
      render();
    }
    // Another tab was dragged, or "Reset position" was pressed in Options.
    if (area === "local" && changes[POSITION_KEY] && !dragging) {
      position = normalizePosition(changes[POSITION_KEY].newValue);
      if (position) applyPosition(position);
      else if (mode === "dragged") resetPlacement();
    }
    if (area === "sync" && changes[SETTINGS_KEY]) {
      settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
      render();
    }
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      visibleSince = Date.now();
      render();
      onRegainFocus();
    }
  };

  // ───────── Lifecycle ─────────

  function contextInvalidated(): boolean {
    try {
      return !chrome.runtime?.id;
    } catch {
      return true;
    }
  }

  /** After the extension is reloaded or removed, this orphaned script cleans up after itself. */
  function teardown(): void {
    timers.forEach((t) => window.clearInterval(t));
    stopUpdatedTicker();
    pageObserver.disconnect();
    themeObserver.disconnect();
    document.removeEventListener("keydown", onDocKeydown);
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onRegainFocus);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", onDragEnd, true);
    window.removeEventListener("pointercancel", onDragEnd, true);
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      // context already gone
    }
    host.remove();
    popHost.remove();
  }

  async function init(): Promise<void> {
    applyTheme();
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    // Read the saved position first so the pill doesn't flash in the top bar before jumping.
    [settings, cache, position] = await Promise.all([readSettings(), readCache(), readPosition()]);

    ensureMounted();
    pageObserver.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => {
      fallbackAllowed = true;
      if (mode === "none") ensureMounted();
    }, FALLBACK_AFTER_MS);
    render();

    chrome.storage.onChanged.addListener(onStorageChanged);
    document.addEventListener("keydown", onDocKeydown);
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onRegainFocus);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onViewportChange, true);

    timers.push(window.setInterval(schedulerTick, SCHEDULER_TICK_MS));
    timers.push(window.setInterval(render, RENDER_TICK_MS));

    if (document.visibilityState === "visible") void maybeFetch({});
  }

  void init();
}
