// Shared building blocks for WAVE MCP tools.
//
// This module is the single source of truth for: (a) the HTTP + content
// helpers that every tool used to duplicate verbatim, and (b) the `WaveToolDef`
// shape that lets one tool list drive BOTH transports (stdio McpServer and the
// in-process Agent SDK server) with zero drift. See ./index.ts for the registry
// and ../server.ts / ../sdk-server.ts for the two consumers.
import type { ZodRawShape, infer as zInfer, ZodObject } from "zod";
import { getApiKey, getAuthHeaders, getApiBaseUrl, getBaseUrl } from "../auth.js";

/**
 * Tool result shape — a single text block. Kept structurally assignable to both
 * MCP's `CallToolResult` and the Agent SDK's, so handlers return it verbatim on
 * either transport. The array is intentionally mutable: both SDKs type their
 * `content` as a mutable array, and a `readonly` one is not assignable to it.
 */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  // MCP's `Result` base (which `CallToolResult` extends) carries an open index
  // signature; declaring it here keeps `ToolResult` assignable to both SDKs.
  [key: string]: unknown;
}

export function textContent(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorContent(status: number, body: string): ToolResult {
  return textContent(`Error ${status}: ${body}`);
}

/** Authenticated fetch against the WAVE API, returning the raw text body. */
export async function waveFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...init?.headers,
    },
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

/** Result of a gateway product call: the decoded text body plus the usage receipt the spoke stamps
 *  on its response. `meter`/`usageMinutes` are what the gateway bills on, so surfacing them lets an
 *  agent see the cost of the call it just made instead of guessing. */
export interface GatewayResult {
  ok: boolean;
  status: number;
  body: string;
  contentType: string;
  meter?: string;
  usageMinutes?: string;
}

/** Authenticated call against the GATEWAY front door (api.wave.online), not the app host.
 *
 *  Deliberately does NOT reuse `waveFetch`: that one targets `getBaseUrl()` (wave.online) and always
 *  sends `Content-Type: application/json`, while the product spokes are content-type sensitive — the
 *  transcribe/captions spokes read the request's content-type to decide how to treat the body, so a
 *  blanket JSON header on a non-JSON call is wrong. Here the caller owns the content-type. */
export async function gatewayFetch(path: string, init?: RequestInit): Promise<GatewayResult> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "User-Agent": "wave-mcp-server/0.1.0",
      ...init?.headers,
    },
  });
  return {
    ok: res.ok,
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get("content-type") ?? "",
    meter: res.headers.get("x-wave-meter") ?? undefined,
    usageMinutes: res.headers.get("x-wave-usage-minutes") ?? undefined,
  };
}

/** Render the spoke's usage receipt as a trailing line, so every metered tool reports what it cost.
 *  Empty when the spoke stamped no meter headers (e.g. an error response). */
export function usageNote(r: GatewayResult): string {
  if (!r.meter) return "";
  const mins = r.usageMinutes ? `, ${r.usageMinutes} min` : "";
  return `\n\n[billed: ${r.meter}${mins}]`;
}

/**
 * A transport-agnostic tool definition. The `inputSchema` is a Zod raw shape
 * (the same object both `McpServer.tool()` and the Agent SDK's `tool()` accept),
 * so a `WaveToolDef[]` can be registered onto either transport by iterating it.
 */
export interface WaveToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodRawShape;
  readonly handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Author a tool with full per-tool argument inference, then erase to the uniform
 * {@link WaveToolDef} so a heterogeneous list stays homogeneous. The handler is
 * typed against the inferred args at the call site; the cast is localized here.
 */
export function defineTool<S extends ZodRawShape>(def: {
  name: string;
  description: string;
  inputSchema: S;
  handler: (args: zInfer<ZodObject<S>>) => Promise<ToolResult>;
}): WaveToolDef {
  return def as unknown as WaveToolDef;
}
