# Usage Meter

Chrome extension (Manifest V3) that shows your ChatGPT 5-hour and 7-day usage limits in a pill in chatgpt.com's top bar. Spec: `../Usage Meter — Chrome Extension Spec.md`.

## Build and load

```sh
npm install
npm run build        # → dist/
npm test             # unit tests (node --test)
npm run typecheck
npm run watch        # rebuild on save; then reload the extension in chrome://extensions
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → pick `dist/`.

## Milestone 1: verify the endpoint first

`fixtures/usage.json` is the sample from the spec, not a real response. On chatgpt.com, signed in, run this in the DevTools console:

```js
const s = await (await fetch("/api/auth/session")).json();
const r = await fetch("/backend-api/wham/usage", {
  headers: { Authorization: `Bearer ${s.accessToken}`, ...(s.account?.id ? { "chatgpt-account-id": s.account.id } : {}) },
});
console.log(r.status, JSON.stringify(await r.json(), null, 2));
```

If the response has `rate_limit` windows with `limit_window_seconds` near 18000 and 604800, save it over `fixtures/usage.json` (strip anything personal) and run `npm test`. If it doesn't, the extension will show "Couldn't refresh / Usage format changed".

## Things to tune on the real site

| What | Where |
| --- | --- |
| Top-bar anchor selectors (falls back to a fixed position after 3 s) | `ANCHOR_SELECTORS` in `src/content/index.ts` |
| "Open usage settings" link target | `USAGE_SETTINGS_URL` in `src/content/popover.ts` |

## Layout

```
src/lib/        api (token + fetch), parse, cache (storage, lock, backoff), pace, format, settings, types
src/content/    index (mount, observers, polling), state (pure view model), pill, popover, dom, styles.css
src/background/ sw (reset alarms + notifications, opens options)
src/popup/      options popup (also registered as the options page)
build.mjs       esbuild bundling, static copy, icon generation, test runner
```
