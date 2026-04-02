/**
 * Authentication utilities for the WAVE MCP Server.
 *
 * Reads credentials from environment variables:
 * - WAVE_API_KEY: Required. Bearer token for WAVE API authentication.
 * - WAVE_BASE_URL: Optional. Defaults to https://wave.online.
 */

const DEFAULT_BASE_URL = "https://wave.online";

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
