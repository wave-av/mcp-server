/**
 * Authentication utilities for the WAVE MCP Server.
 *
 * Reads credentials from environment variables:
 * - WAVE_API_KEY: Required. Bearer token for WAVE API authentication.
 * - WAVE_BASE_URL: Optional. Defaults to https://wave.online.
 * - WAVE_API_BASE_URL: Optional. Defaults to https://api.wave.online — the GATEWAY front door.
 * - WAVE_DISPATCH_URL: Optional. Defaults to https://dispatch.wave.online.
 */

const DEFAULT_BASE_URL = "https://wave.online";

/** The gateway front door. DISTINCT from `WAVE_BASE_URL`: the app surface (`/api/v1/billing/...`)
 *  lives on wave.online, while the metered product spokes (voice / transcribe / captions, and the
 *  x402+MPP payment rails) are served through the gateway at api.wave.online under `/v1/...`.
 *  Pointing product calls at the app host silently 404s, so the two are kept separate on purpose. */
const DEFAULT_API_BASE_URL = "https://api.wave.online";

/** wave-dispatch runs on its OWN host, not behind the product gateway, and takes a plain bearer. */
const DEFAULT_DISPATCH_URL = "https://dispatch.wave.online";

export function getApiKey(): string {
  const key = process.env["WAVE_API_KEY"];
  if (!key) {
    throw new Error(
      "WAVE_API_KEY environment variable is required. " +
        "Set it to your WAVE API key before starting the MCP server. " +
        "You can generate one at https://wave.online/settings/api-keys",
    );
  }
  return key;
}

export function getBaseUrl(): string {
  return process.env["WAVE_BASE_URL"] ?? DEFAULT_BASE_URL;
}

/** Base URL for gateway-fronted product calls (`/v1/voice`, `/v1/transcribe`, `/v1/captions`,
 *  `/v1/mpp/*`). See {@link DEFAULT_API_BASE_URL} for why this is not `getBaseUrl()`. */
export function getApiBaseUrl(): string {
  return process.env["WAVE_API_BASE_URL"] ?? DEFAULT_API_BASE_URL;
}

/** Base URL for wave-dispatch, which is NOT behind the product gateway. */
export function getDispatchUrl(): string {
  return process.env["WAVE_DISPATCH_URL"] ?? DEFAULT_DISPATCH_URL;
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
