// Shared building blocks for WAVE MCP tools.
//
// This module is the single source of truth for: (a) the HTTP + content
// helpers that every tool used to duplicate verbatim, and (b) the `WaveToolDef`
// shape that lets one tool list drive BOTH transports (stdio McpServer and the
// in-process Agent SDK server) with zero drift. See ./index.ts for the registry
// and ../server.ts / ../sdk-server.ts for the two consumers.
import type { ZodRawShape, infer as zInfer, ZodObject } from "zod";
import { getAuthHeaders, getBaseUrl } from "../auth.js";

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
