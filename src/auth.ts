/**
 * Authentication utilities for the WAVE MCP Server.
 *
 * Reads credentials from environment variables:
 * - WAVE_API_KEY: Required. Bearer token for WAVE API authentication.
 * - WAVE_BASE_URL: Optional. Defaults to https://api.wave.online.
 *
 * WHY api.wave.online AND WHY THE TOOL PATHS ARE `/v1/*` (#89):
 * `https://wave.online` is the marketing/app origin — it 404s on the API surface, so every one of
 * this package's tools failed with the previous default. `https://api.wave.online` is the public
 * API origin, and its public path space is `/v1/*` — NOT `/api/v1/*`, which is an internal path
 * shape that is not routable by a client on any host. Measured 2026-08-07:
 *   POST https://api.wave.online/v1/streams      → 402 (route exists, priced)
 *   POST https://api.wave.online/api/v1/streams  → 404 (not a routable API path)
 *   POST https://wave.online/api/v1/streams      → 404 (wrong origin entirely)
 * A 402 is the CORRECT unauthenticated answer here — it proves the route exists and is priced.
 */

const DEFAULT_BASE_URL = "https://api.wave.online";

/** Where a human mints an API key. Must be a page that actually resolves (#89). */
export const API_KEY_CONSOLE_URL = "https://console.wave.online/dashboard#keys";

export function getApiKey(): string {
  const key = process.env["WAVE_API_KEY"];
  if (!key) {
    throw new Error(
      "WAVE_API_KEY environment variable is required. " +
        "Set it to your WAVE API key before starting the MCP server. " +
        `You can generate one at ${API_KEY_CONSOLE_URL}`,
    );
  }
  return key;
}

/** Loopback hosts, where a cleartext `http://` origin cannot be intercepted on the wire. */
function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/**
 * Resolve the API origin. An explicitly-set WAVE_BASE_URL is validated rather than trusted: a malformed
 * value would otherwise surface far downstream as an opaque fetch failure inside every tool call.
 *
 * Returns `parsed.origin`, NOT the raw string. Tool paths are absolute (`/v1/...`) and are concatenated
 * onto this value, so anything beyond scheme+host+port silently corrupts every request URL: a trailing
 * slash yields `//v1/...`, surrounding whitespace (which the URL parser tolerates but string
 * concatenation does not) yields an unusable address, and a path/query/fragment would push the appended
 * `/v1/...` into the wrong position entirely. A path/query/fragment is REJECTED loudly rather than
 * silently discarded, because a caller who set one meant something by it.
 *
 * `http://` is refused except on loopback: every request built from this origin attaches
 * `Authorization: Bearer <WAVE_API_KEY>`, so a cleartext remote origin would put the API key on the wire
 * in the clear. Loopback stays allowed so a local gateway/proxy remains usable in development.
 */
export function getBaseUrl(): string {
  const configured = process.env["WAVE_BASE_URL"];
  if (configured === undefined || configured.trim() === "") return DEFAULT_BASE_URL;
  const raw = configured.trim();

  const expected = `Expected a bare origin like ${DEFAULT_BASE_URL} (no path, query or fragment). Unset it to use the default.`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`WAVE_BASE_URL is not a valid absolute URL: ${JSON.stringify(configured)}. ${expected}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`WAVE_BASE_URL must be an http(s) URL, got ${JSON.stringify(configured)}. ${expected}`);
  }
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    throw new Error(
      `WAVE_BASE_URL must use https for a remote host, got ${JSON.stringify(configured)}. ` +
        "Every request sends your WAVE_API_KEY as a bearer token, which http would transmit in cleartext. " +
        "Use https://, or a loopback host (localhost / 127.0.0.1) for local development.",
    );
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(
      `WAVE_BASE_URL must be an origin only — got ${JSON.stringify(configured)}, which carries a ` +
        `path/query/fragment. Tool paths (\`/v1/...\`) are appended to this value. ${expected}`,
    );
  }
  return parsed.origin;
}

/**
 * Validate configuration EAGERLY, at process start.
 *
 * `getBaseUrl` is only reached when a tool actually runs, so on its own it would surface a bad
 * WAVE_BASE_URL once per tool call rather than once at startup — which is the behaviour this change set
 * out to remove. `startServer()` calls this before binding the transport, so a misconfigured server dies
 * immediately with a message naming the offending value.
 *
 * WAVE_API_KEY is deliberately NOT required here: the server is useful to start (tools/list, discovery)
 * without one, and `getApiKey()` already raises an actionable error on first authenticated use.
 */
export function assertConfigValid(): void {
  getBaseUrl();
}

export function getAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
    "User-Agent": "wave-mcp-server/0.1.0",
  };
}

/**
 * Rate-limit-aware fetch wrapper for WAVE API.
 * Tracks remaining quota from response headers and retries on 429.
 */
export async function waveFetchWithRateLimit(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: string; rateLimit?: RateLimitInfo }> {
  const url = `${getBaseUrl()}${path}`;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...getAuthHeaders(),
        ...init?.headers,
      },
    });

    const rateLimit = parseRateLimitHeaders(res.headers);

    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "2");
      process.stderr.write(
        `[wave-mcp-server] Rate limited. Retrying in ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})\n`,
      );
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    const body = await res.text();

    if (rateLimit && rateLimit.remaining < 10) {
      process.stderr.write(
        `[wave-mcp-server] Rate limit warning: ${rateLimit.remaining}/${rateLimit.limit} remaining (resets ${rateLimit.reset})\n`,
      );
    }

    return { ok: res.ok, status: res.status, body, rateLimit };
  }

  return { ok: false, status: 429, body: "Rate limit exceeded after retries" };
}

export interface RateLimitInfo {
  readonly limit: number;
  readonly remaining: number;
  readonly reset: string;
}

function parseRateLimitHeaders(headers: Headers): RateLimitInfo | undefined {
  const limit = headers.get("X-RateLimit-Limit");
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset = headers.get("X-RateLimit-Reset");

  if (!limit || !remaining) return undefined;

  return {
    limit: Number(limit),
    remaining: Number(remaining),
    reset: reset ?? "",
  };
}
