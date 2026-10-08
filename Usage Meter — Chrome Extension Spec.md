# Usage Meter — Chrome Extension Spec

Oct 8, 2026 · @Matt

## Overview

Usage Meter is a Manifest V3 Chrome extension that puts the ChatGPT 5-hour and 7-day usage limits in a small pill in the chat page's top bar, so you never open Settings to check them. Clicking the pill opens a popover with reset countdowns and a pace marker.

**Goals**

- Show 5-hour and 7-day % used at a glance on chatgpt.com, updated without a page reload.
- Warn visually at 70% and 90% (configurable), and show a countdown when a limit is hit.
- Show whether usage is ahead of or behind the time elapsed in each window (pace).
- Keep all data in the browser; no backend, no analytics.

**Non-goals (v1)**

- Usage history, charts or per-model breakdowns.
- Firefox / Safari builds.
- Any action on the account (buying credits, changing plans).
- Showing usage on pages other than chatgpt.com.

Design source: the Usage Meter Extension UI canvas (artboards: In context, Pill states, Options popup).

## Data source

The numbers come from `GET https://chatgpt.com/backend-api/wham/usage`, the same internal endpoint behind the usage page in ChatGPT settings. It is undocumented, so the extension treats its shape as something that can change and fails soft.

**Auth.** The request needs a Bearer access token. On chatgpt.com the signed-in session already exposes one: a same-origin `GET /api/auth/session` (cookies included) returns `accessToken`. The extension fetches it, keeps it in memory only, and re-fetches it on any 401.

**Request**

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <accessToken>` |
| `Accept` | `application/json` |
| `chatgpt-account-id` | account id, when the session has one (Team/Enterprise workspaces) |

**Response fields used** (everything else is ignored)

```json
{
  "plan_type": "plus",
  "rate_limit": {
    "primary_window":   { "used_percent": 38, "limit_window_seconds": 18000,  "reset_at": 1791450720 },
    "secondary_window": { "used_percent": 71, "limit_window_seconds": 604800, "reset_at": 1791814800 }
  }
}
```

- `used_percent`: 0–100, clamp before display.
- `limit_window_seconds`: identifies the window. Match by value, not by primary/secondary: about 18,000 s = 5-hour, about 604,800 s = 7-day (±120 s tolerance).
- `reset_at`: Unix seconds when the window resets. Countdown, reset clock time and pace all derive from it.
- A window that is missing renders as "—" in its slot; it does not hide the pill.

**Risks**

- Endpoint path or fields change → parser returns `null`, pill goes to the "Couldn't refresh" state, options page shows "Usage format changed — update the extension."
- Rate limiting by ChatGPT → poll no faster than every 30 s, back off on 429.
- Terms of service: reading your own account data with your own session is low-risk, but it is unofficial; keep it read-only and personal.

Shape confirmed against the open-source [pi-chatgpt-limit](https://github.com/patlux/pi-chatgpt-limit) client (v0.3.1), which parses the same endpoint. Verify in DevTools → Network on your account before building (milestone 1).

"wham" appears to be the internal name of Codex's backend, so this endpoint may report Codex limits rather than regular chat limits. Milestone 1 settles this before anything else is built.

## Architecture

Three Manifest V3 parts: a content script on chatgpt.com does all fetching and rendering, `chrome.storage` shares results between tabs, and a small service worker handles reset notifications. No server of our own.

```
                chatgpt.com (same origin, login cookie)
          ┌──────────────────────────────────────────────┐
          │  (1) GET /api/auth/session   → accessToken   │
          │  (2) GET /backend-api/wham/usage → windows    │
          └───────────────▲──────────────────────────────┘
                          │ fetch
 ┌────────────────────────┴───┐   write snapshot   ┌────────────────────────┐
 │ Content script (each tab)  │ ─────────────────▶ │ chrome.storage.local   │
 │ pill + popover, polling    │ ◀───────────────── │ cache (shared by tabs) │
 └────────────────────────────┘   storage.onChanged └───────────┬────────────┘
                                                               │ onChanged
 ┌────────────────────────────┐                    ┌───────────▼────────────┐
 │ Options popup              │ ─ chrome.storage ─▶│ Service worker         │
 │ settings (storage.sync)    │      .sync         │ reset alarms + notices │
 └────────────────────────────┘                    └────────────────────────┘
```

The content script gets a token (1), fetches usage (2), and writes the snapshot to storage; every other open tab re-renders from `storage.onChanged` instead of fetching again.

**Why the content script fetches.** It runs on chatgpt.com, so requests are same-origin and carry the login cookie with no extra setup. Fetching from the service worker would need cross-site cookie handling and wouldn't know whether a chat tab is visible.

**manifest.json (key parts)**

```json
{
  "manifest_version": 3,
  "name": "Usage Meter",
  "permissions": ["storage", "alarms"],
  "optional_permissions": ["notifications"],
  "host_permissions": ["https://chatgpt.com/*"],
  "content_scripts": [{ "matches": ["https://chatgpt.com/*"], "js": ["content.js"], "run_at": "document_idle" }],
  "background": { "service_worker": "sw.js" },
  "action": { "default_popup": "popup.html" }
}
```

`notifications` is only needed for the optional reset alert, so it is an optional permission, requested when the user turns that setting on.

## UI spec

One pill in the top bar, left of the avatar, with a popover on click — placement A from the design canvas. Nothing else is added to the page.

**Mounting**

- Render inside a Shadow DOM root on a host `<div id="usage-meter-root">` so ChatGPT's CSS can't leak in and ours can't leak out.
- Anchor: insert before the avatar/profile button in the top bar header. Selector lives in one constant (`ANCHOR_SELECTORS`, tried in order) because ChatGPT's markup changes.
- Fallback: if no anchor is found within 3 s, mount `position: fixed; top: 10px; right: 64px` so the meter still shows.
- Theme: follow the page — dark when `<html>` has class `dark`, else light. Re-check on class change.
- Drag to move: dragging the pill (more than 4 px) pins it at `position: fixed` where it is dropped, on every chatgpt.com tab; a plain click still opens the popover. The spot is kept on screen when the window shrinks, and the popover flips above or shifts sideways near an edge. Options › Placement › "Reset position" returns it to the top bar.

**Pill** (36 px tall, radius 18 px)

- Per window: label (`5h`, `7d`) · 36×4 px bar · value (`38%`). Divider between windows, chevron at the end.
- Numbers in a monospace face (Geist Mono, falling back to `ui-monospace`) so digits don't jump.
- `aria-label` reads both values in words, e.g. "Usage: 5-hour 38% used, 7-day 71% used".

**States** (one at a time; worst window decides the pill-level state)

| State | Trigger | Pill shows |
| --- | --- | --- |
| Loading | no data yet | gray skeleton bars |
| Normal | both windows below warn threshold | blue bars |
| Warning | any window ≥ warn (default 70%) | that window orange |
| Critical | any window ≥ critical (default 90%) | red tint, warning icon, that window red |
| Limit reached | any window ≥ 100% | solid red, "Limit · back in 1h 12m" for that window |
| Couldn't refresh | 2 failed fetches in a row, or data older than 3× interval (after a fetch has failed, or 15 s after the tab became visible, so a refocus fetch in flight doesn't trigger it) | last values dimmed, dashed border, age chip ("6m old"); click retries |
| Signed out | `/api/auth/session` has no token | "Sign in to see usage" in muted text |
| Open | popover visible | blue outline on the pill |
| Compact | user option | two 20 px rings, numbers in tooltip |

Precedence: Signed out → Loading → level (Limit reached → Critical → Warning → Normal). Couldn't refresh is drawn over the level (the last values keep their level colors, dimmed). Open and Compact are modifiers that combine with any state.

**Popover** (328 px wide, anchored under the pill, right-aligned)

- Header: "Usage", "Updated 12s ago", refresh button.
- Per window: name, big % used, "resets in 2h 41m", 8 px bar with a 2 px pace tick at % of window elapsed, caption "46% of window elapsed" and the reset clock time.
- Pace label: "Under pace", "On pace" or "Ahead of pace" (rule in Behavior).
- Footer: "Open usage settings" link (opens ChatGPT's usage page in a new tab) and an Options button.
- Closes on outside click, Escape, or pill click. Focus moves into the popover on open and back to the pill on close.

**Colors**

| Token | Light | Dark |
| --- | --- | --- |
| ok (bar) | #2F6FEB | #6EA0FF |
| warn (bar) | #EA6A12 | #FB923C |
| warn (text) | #B4400A | #FDBA74 |
| critical | #9F1D1D | #F87171 |
| limit fill | #9F1D1D | #B42323 |
| track | #ECECEF | #3D3D44 |

Warning and critical are also told apart by the icon and label, not by color alone.

## Behavior

Fetch every 60 s while a chatgpt.com tab is visible, share one cached result across all tabs, and tick countdowns locally between fetches.

**When to fetch**

- On mount, if the cache is older than the refresh interval.
- Every refresh interval (default 60 s) while `document.visibilityState === "visible"`; paused when hidden.
- When the tab regains focus, if the cache is older than 15 s.
- When the popover opens, if the cache is older than 15 s.
- On the refresh button or a click on the "Couldn't refresh" pill — always, but debounced to once per 5 s.

**One fetch for many tabs.** Before fetching, read `cache.fetchedAt` from `chrome.storage.local`; skip if fresh. After a fetch, write the snapshot; every tab re-renders from `chrome.storage.onChanged`. A short `fetchLock` timestamp (10 s) stops two tabs fetching at the same moment. `chrome.storage` has no atomic compare-and-set, so the lock is best-effort: a rare double fetch is possible and harmless.

**Between fetches.** Countdowns, "Updated Ns ago" and pace recompute every 30 s from `reset_at` and the clock. When `now ≥ reset_at`, show that window as 0% and fetch right away.

**Pace**

```latex
\text{elapsed}\% = \frac{\text{now} - (\text{reset\_at} - \text{window})}{\text{window}} \times 100, \qquad \text{pace} = \text{used}\% - \text{elapsed}\%
```

| Pace | Label | Color |
| --- | --- | --- |
| below −5 points | Under pace | ok |
| −5 to +5 points | On pace | muted |
| above +5 points | Ahead of pace | warn |

**Errors**

| Case | Response |
| --- | --- |
| 401 / 403 | Re-fetch the session token once and retry; if still failing → Signed out state |
| No `accessToken` in session | Signed out state; retry on next focus |
| 429 | Back off: 2 min, doubling to a 10 min cap; keep last values |
| Network error / timeout (10 s) | Keep last values; after 2 failures in a row → Couldn't refresh |
| Response parses to no windows | Couldn't refresh + "Usage format changed" in options |

**Page changes.** ChatGPT is a single-page app and re-renders its header. A `MutationObserver` on the header's parent (falling back to `body`, throttled to once per 500 ms) re-inserts the host if it was removed. The extension never edits ChatGPT's own nodes.

## Options and storage

Settings live in `chrome.storage.sync` so they follow you across devices signed into the same Chrome account; the usage snapshot lives in `chrome.storage.local` and never syncs. The access token is never stored.

**Settings** (`chrome.storage.sync`, key `settings`)

| Key | Type | Default | Options popup control |
| --- | --- | --- | --- |
| `showFiveHour` | boolean | true | Show › 5-hour window |
| `showWeekly` | boolean | true | Show › 7-day window |
| `showPace` | boolean | true | Show › Pace marker on bars |
| `compact` | boolean | false | Placement › Compact (rings only) |
| `display` | `"used"` \| `"remaining"` | `"used"` | Display as |
| `warnAt` | number 1–99 | 70 | Alerts › Warn at |
| `criticalAt` | number 1–100 | 90 | Alerts › Critical at (must be > `warnAt`) |
| `notifyOnReset` | boolean | false | Alerts › Notify when a window resets |
| `refreshSeconds` | 30 \| 60 \| 300 | 60 | Refresh every |

The placement control from the design is dropped: v1 ships placement A only, plus drag to move.

**Pill position** (`chrome.storage.local`, key `pillPosition`): `{ top, right }` in px from the viewport's top and right edges, or absent for the automatic spot. Local rather than sync, because a good spot on one screen is often wrong on another.

**Cache** (`chrome.storage.local`)

```ts
type UsageWindow = { usedPercent: number; windowSeconds: number; resetAt: number };

type Cache = {
  snapshot: { planType?: string; fiveHour?: UsageWindow; weekly?: UsageWindow } | null;
  fetchedAt: number;          // ms epoch of last successful fetch
  lastError?: { kind: "auth" | "rate" | "network" | "format"; at: number };
  failStreak: number;
  rateStreak?: number;        // consecutive 429s, drives the 2 → 10 min backoff
  backoffUntil?: number;      // ms epoch; scheduled fetches wait until then
  fetchLock?: number;         // ms epoch; ignored after 10 s
  schemaVersion: 1;
};
```

## Build plan

TypeScript, bundled with esbuild into plain files Chrome loads unpacked; no framework — the UI is small enough for hand-written DOM inside the shadow root.

**Files**

```
usage-meter/
  manifest.json
  src/
    content/
      index.ts        # mount, observer, theme, render loop
      state.ts        # cache + settings → view model (pure, unit-tested)
      pill.ts         # pill + states
      popover.ts      # popover + focus handling
      dom.ts          # tiny element builder + icons
      styles.css      # injected into the shadow root
    lib/
      api.ts          # session token + wham/usage fetch, error mapping
      parse.ts        # response → UsageWindow (match by window length)
      cache.ts        # storage read/write, fetchLock, freshness, backoff
      pace.ts         # elapsed %, pace, labels
      format.ts       # "2h 41m", "Tue 14:20", percent clamp
      settings.ts     # defaults, validation, chrome.storage.sync
      position.ts     # dragged pill position: storage + clamp to viewport
      types.ts
    background/
      sw.ts           # reset notifications via chrome.alarms
    popup/
      popup.html
      popup.css
      popup.ts        # options UI bound to chrome.storage.sync
  fixtures/usage.json # sample response; replace with a real one in milestone 1
  tests/              # node --test suites
  build.mjs           # esbuild script → dist/, icons, test runner
```

**Milestones**

1. Verify: in DevTools on chatgpt.com, call `/api/auth/session` then `/backend-api/wham/usage` from the console; save a real response as `fixtures/usage.json`.
2. Data layer: `api.ts`, `parse.ts`, `pace.ts`, `format.ts` with unit tests against the fixture.
3. Pill: mount, anchor fallback, theme, Normal / Warning / Critical / Limit states from cached data.
4. Polling + cache: visibility pause, focus refresh, multi-tab lock, error states.
5. Popover: details, pace tick, refresh button, keyboard and focus.
6. Options popup + settings wiring; reset notifications in the service worker.
7. Polish: compact mode, Signed out state, load-unpacked test on a real account for a day.

**Testing checklist**

- [ ] Parser handles missing window, swapped primary/secondary, extra fields, `used_percent` > 100
- [ ] Pace labels at −10, 0, +10 points
- [ ] Countdown rolls over to 0% at `reset_at` and triggers a fetch
- [ ] Two open tabs make one request per interval
- [ ] Hidden tab makes no requests
- [ ] 401 → token refresh → success; 401 twice → Signed out
- [ ] 429 backs off; network failure ×2 → Couldn't refresh with age chip
- [ ] Pill survives a new chat, switching chats, and a model switch
- [ ] Anchor not found → fixed-position fallback
- [ ] Light and dark theme switch live
- [ ] Screen reader reads the pill's `aria-label`; Escape closes the popover

**Open questions**

- Does the endpoint report the 5-hour and weekly windows for your plan in the regular chat (not only Codex)? Milestone 1 answers this.
- Exact selector for the top-bar avatar button — pick during milestone 3.
- Exact URL of ChatGPT's usage page for the "Open usage settings" link (currently `/codex/settings/usage`).
- Publish to the Chrome Web Store, or keep it load-unpacked for personal use?
