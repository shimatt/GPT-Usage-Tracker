import { parseUsage } from "./parse";
import type { ErrorKind, Snapshot } from "./types";

export const ORIGIN = "https://chatgpt.com";
const SESSION_PATH = "/api/auth/session";
const USAGE_PATH = "/backend-api/wham/usage";
const TIMEOUT_MS = 10_000;

export type FetchOutcome =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; kind: ErrorKind; retryAfterMs?: number };

type Token = { accessToken: string; accountId?: string };
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

class NetworkError extends Error {}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

/**
 * The session token lives only in this closure (memory), never in storage. It is fetched on
 * first use and fetched again after any 401/403.
 */
export function createApi(fetchImpl: FetchFn = (input, init) => fetch(input, init), now: () => number = Date.now) {
  let token: Token | null = null;

  async function timedFetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetchImpl(ORIGIN + path, { ...init, credentials: "include", cache: "no-store", signal: controller.signal });
    } catch {
      throw new NetworkError("request failed or timed out");
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadToken(): Promise<Token | null> {
    const res = await timedFetch(SESSION_PATH, { headers: { Accept: "application/json" } });
    if (isAuthStatus(res.status)) return null;
    if (!res.ok) throw new NetworkError(`session ${res.status}`);
    const body: unknown = await res.json().catch(() => null);
    if (typeof body !== "object" || body === null) return null;
    const { accessToken, account } = body as { accessToken?: unknown; account?: { id?: unknown } };
    if (typeof accessToken !== "string" || !accessToken) return null;
    const accountId = typeof account?.id === "string" && account.id ? account.id : undefined;
    return { accessToken, accountId };
  }

  function requestUsage(t: Token): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${t.accessToken}`, Accept: "application/json" };
    if (t.accountId) headers["chatgpt-account-id"] = t.accountId;
    return timedFetch(USAGE_PATH, { headers });
  }

  async function fetchUsage(): Promise<FetchOutcome> {
    try {
      token ??= await loadToken();
      if (!token) return { ok: false, kind: "auth" };

      let res = await requestUsage(token);
      if (isAuthStatus(res.status)) {
        token = await loadToken();
        if (!token) return { ok: false, kind: "auth" };
        res = await requestUsage(token);
        if (isAuthStatus(res.status)) {
          token = null;
          return { ok: false, kind: "auth" };
        }
      }

      if (res.status === 429) {
        return { ok: false, kind: "rate", retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), now()) };
      }
      if (!res.ok) return { ok: false, kind: "network" };

      const json: unknown = await res.json().catch(() => undefined);
      if (json === undefined) return { ok: false, kind: "format" };
      const snapshot = parseUsage(json, now());
      return snapshot ? { ok: true, snapshot } : { ok: false, kind: "format" };
    } catch {
      return { ok: false, kind: "network" };
    }
  }

  return {
    fetchUsage,
    clearToken: () => {
      token = null;
    },
  };
}
