/**
 * WAVE MCP Server — Agent SDK In-Process Mode
 *
 * Alternative to the stdio-based server.ts for use with the Claude Agent SDK.
 * Runs in-process with zero subprocess overhead (~50ms vs ~500ms startup).
 *
 * Usage:
 *   import { waveInProcessServer } from '@wave-av/mcp-server/sdk-server';
 *   const options = { mcp_servers: { wave: waveInProcessServer } };
 *
 * @see https://docs.claude.com/en/api/agent-sdk/typescript
 */

// Note: createSdkMcpServer and tool are imported from the Agent SDK.
// If @anthropic-ai/claude-agent-sdk is not installed, this module
// gracefully falls back to a stub that logs a warning.

import { z } from "zod";
import { getAuthHeaders, getBaseUrl } from "./auth.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolAnnotations {
  readOnly?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
}

interface SdkToolResult {
  type: "success" | "error";
  result?: string;
  error?: string;
}

type SdkTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<SdkToolResult>;
  annotations?: ToolAnnotations;
};

// ─── HTTP Helper ─────────────────────────────────────────────────────────────

async function waveFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...getAuthHeaders(), ...init?.headers },
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const listStreamsTool: SdkTool = {
  name: "wave_list_streams",
  description: "List all streams in your WAVE account with pagination",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).optional().describe("Max streams (1-100, default 25)"),
    offset: z.number().int().min(0).optional().describe("Pagination offset"),
    status: z.enum(["active", "idle", "error", "all"]).optional().describe("Filter by status"),
  }),
  handler: async (args) => {
    const params = new URLSearchParams();
    params.set("limit", String(args.limit ?? 25));
    params.set("offset", String(args.offset ?? 0));
    if (args.status && args.status !== "all") params.set("status", String(args.status));
    const res = await waveFetch(`/api/streams?${params}`);
    if (!res.ok) return { type: "error", error: `Error ${res.status}: ${res.body}` };
    return { type: "success", result: res.body };
  },
  annotations: { readOnly: true, destructive: false, openWorld: false },
};

const getStreamTool: SdkTool = {
  name: "wave_get_stream",
  description: "Get detailed information about a specific stream",
  inputSchema: z.object({
    stream_id: z.string().describe("The stream ID to look up"),
  }),
  handler: async (args) => {
    const res = await waveFetch(`/api/streams/${args.stream_id}`);
    if (!res.ok) return { type: "error", error: `Error ${res.status}: ${res.body}` };
    return { type: "success", result: res.body };
  },
  annotations: { readOnly: true, destructive: false, openWorld: false },
};

const createStreamTool: SdkTool = {
  name: "wave_create_stream",
  description: "Create a new live stream",
  inputSchema: z.object({
    title: z.string().describe("Stream title"),
    protocol: z.enum(["rtmp", "srt", "webrtc", "whip"]).optional().describe("Ingest protocol"),
    quality: z.enum(["720p", "1080p", "4k"]).optional().describe("Target quality"),
  }),
  handler: async (args) => {
    const res = await waveFetch("/api/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) return { type: "error", error: `Error ${res.status}: ${res.body}` };
    return { type: "success", result: res.body };
  },
  annotations: { readOnly: false, destructive: false, openWorld: false },
};

const getAnalyticsTool: SdkTool = {
  name: "wave_get_analytics",
  description: "Get analytics for a stream or across the account",
  inputSchema: z.object({
    stream_id: z.string().optional().describe("Stream ID (omit for account-wide)"),
    period: z.enum(["1h", "24h", "7d", "30d"]).optional().describe("Time period"),
  }),
  handler: async (args) => {
    const params = new URLSearchParams();
    if (args.stream_id) params.set("stream_id", String(args.stream_id));
    if (args.period) params.set("period", String(args.period));
    const res = await waveFetch(`/api/analytics?${params}`);
    if (!res.ok) return { type: "error", error: `Error ${res.status}: ${res.body}` };
    return { type: "success", result: res.body };
  },
  annotations: { readOnly: true, destructive: false, openWorld: false },
};

const getBillingTool: SdkTool = {
  name: "wave_get_billing",
  description: "Get current billing status and usage summary",
  inputSchema: z.object({}),
  handler: async () => {
    const res = await waveFetch("/api/billing/summary");
    if (!res.ok) return { type: "error", error: `Error ${res.status}: ${res.body}` };
    return { type: "success", result: res.body };
  },
  annotations: { readOnly: true, destructive: false, openWorld: false },
};

// ─── Tool Registry with Annotations ─────────────────────────────────────────

export const WAVE_SDK_TOOLS: SdkTool[] = [
  listStreamsTool,
  getStreamTool,
  createStreamTool,
  getAnalyticsTool,
  getBillingTool,
];

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = Object.fromEntries(
  WAVE_SDK_TOOLS.map((t) => [t.name, t.annotations ?? {}]),
);

/**
 * Create the in-process MCP server config.
 *
 * When @anthropic-ai/claude-agent-sdk is available, returns a real
 * McpSdkServerConfig. Otherwise returns the tool definitions for
 * manual wiring.
 */
export async function createWaveInProcessServer() {
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const sdkTools = WAVE_SDK_TOOLS.map((t) =>
      sdk.tool(
        t.name,
        t.description,
        t.inputSchema.shape,
        async (args: Record<string, unknown>, _extra: unknown) => {
          const result = await t.handler(args);
          return {
            content: [{ type: "text" as const, text: result.result ?? result.error ?? "" }],
          };
        },
        {
          annotations: t.annotations ? {
            readOnlyHint: t.annotations.readOnly,
            destructiveHint: t.annotations.destructive,
            openWorldHint: t.annotations.openWorld,
          } : undefined,
        },
      ),
    );
    return sdk.createSdkMcpServer({
      name: "wave-mcp-server",
      version: "1.0.0",
      tools: sdkTools,
    });
  } catch {
    // Agent SDK not installed — return tool definitions for manual use
    return {
      name: "wave-mcp-server",
      version: "1.0.0",
      tools: WAVE_SDK_TOOLS,
      _fallback: true,
    };
  }
}
