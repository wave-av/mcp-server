import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthHeaders, getBaseUrl } from "../auth.js";

async function waveFetch(
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

function textContent(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text }] };
}

function errorContent(
  status: number,
  body: string,
): { content: Array<{ type: "text"; text: string }> } {
  return textContent(`Error ${status}: ${body}`);
}

export function registerStreamTools(server: McpServer): void {
  server.tool(
    "wave_list_streams",
    "List all streams in your WAVE account with pagination support",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of streams to return (1-100, default 25)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of streams to skip for pagination (default 0)"),
      status: z
        .enum(["active", "idle", "error", "all"])
        .optional()
        .describe("Filter by stream status"),
    },
    async ({ limit, offset, status }) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit ?? 25));
      params.set("offset", String(offset ?? 0));
      if (status && status !== "all") {
        params.set("status", status);
      }

      const res = await waveFetch(`/api/v1/streams?${params.toString()}`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );

  server.tool(
    "wave_create_stream",
    "Create a new stream in your WAVE account",
    {
      title: z.string().min(1).max(255).describe("Stream title"),
      description: z.string().max(2000).optional().describe("Stream description"),
      protocol: z
        .enum(["webrtc", "srt", "rtmp", "hls"])
        .optional()
        .describe("Streaming protocol (default: webrtc)"),
      record: z.boolean().optional().describe("Enable recording for this stream (default: false)"),
      region: z
        .string()
        .optional()
        .describe("Preferred ingest region (e.g., us-east-1, eu-west-1)"),
    },
    async ({ title, description, protocol, record, region }) => {
      const payload: Record<string, unknown> = { title };
      if (description !== undefined) payload["description"] = description;
      if (protocol !== undefined) payload["protocol"] = protocol;
      if (record !== undefined) payload["record"] = record;
      if (region !== undefined) payload["region"] = region;

      const res = await waveFetch("/api/v1/streams", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );

  server.tool(
    "wave_start_stream",
    "Start a stream by its ID, transitioning it to the active state",
    {
      stream_id: z.string().uuid().describe("The UUID of the stream to start"),
    },
    async ({ stream_id }) => {
      const res = await waveFetch(`/api/v1/streams/${stream_id}/start`, {
        method: "POST",
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );

  server.tool(
    "wave_stop_stream",
    "Stop an active stream by its ID",
    {
      stream_id: z.string().uuid().describe("The UUID of the stream to stop"),
    },
    async ({ stream_id }) => {
      const res = await waveFetch(`/api/v1/streams/${stream_id}/stop`, {
        method: "POST",
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );

  server.tool(
    "wave_get_stream_health",
    "Get real-time health metrics for a stream including bitrate, frame rate, and latency",
    {
      stream_id: z.string().uuid().describe("The UUID of the stream to check"),
    },
    async ({ stream_id }) => {
      const res = await waveFetch(`/api/v1/streams/${stream_id}/health`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );
}
