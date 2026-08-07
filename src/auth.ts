/**
 * Authentication utilities for the WAVE MCP Server.
 *
 * Reads credentials from environment variables:
 * - WAVE_API_KEY: Required. Bearer token for WAVE API authentication.
 * - WAVE_BASE_URL: Optional. Defaults to https://api.wave.online.
 *
 * WHY api.wave.online AND WHY THE TOOL PATHS ARE `/v1/*` (#89):
 * `https://wave.online` is the marketing/app origin — it 404s on the API surface, so every one of
 * this package's tools failed with the previous default. The API is served by wave-gateway, which
 * is the single billing/auth authority: it scope-gates the request, meters it, and runs the x402
 * paywall. Its PUBLIC path space is `/v1/*`; the gateway itself re-prefixes to the spoke origin's
 * `/api/v1/*` on forward (wave-gateway src/forward.ts ORIGIN_PATH_PREFIX). Calling `/api/v1/*`
 * here therefore misses the gateway's route map even on the right host. Measured 2026-08-07:
 *   POST https://api.wave.online/v1/streams      → 402 (route exists, priced)
 *   POST https://api.wave.online/api/v1/streams  → 404 (not a gateway route)
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

/**
 * Resolve the API origin. An explicitly-set WAVE_BASE_URL is validated rather than trusted: a
 * malformed or non-http(s) value would otherwise surface far downstream as an opaque fetch
 * failure inside a tool call. Fail loud, at startup, naming the offending value.
 */
export function getBaseUrl(): string {
  const configured = process.env["WAVE_BASE_URL"];
  if (configured === undefined || configured === "") return DEFAULT_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(
      `WAVE_BASE_URL is not a valid absolute URL: ${JSON.stringify(configured)}. ` +
        `Expected an origin like ${DEFAULT_BASE_URL} (no trailing path). ` +
        "Unset it to use the default.",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `WAVE_BASE_URL must be an http(s) URL, got ${JSON.stringify(configured)}. ` +
        `Expected an origin like ${DEFAULT_BASE_URL}.`,
    );
  }
  // Tool paths are absolute (`/v1/...`), so a trailing slash would produce `//v1/...`.
  return configured.replace(/\/+$/, "");
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
