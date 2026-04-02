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

export function registerAnalyticsTools(server: McpServer): void {
  server.tool(
    "wave_get_viewers",
    "Get current viewer count and viewer demographics for a stream or across all streams",
    {
      stream_id: z
        .string()
        .uuid()
        .optional()
        .describe("Stream ID to get viewers for. Omit for account-wide totals."),
      include_demographics: z
        .boolean()
        .optional()
        .describe("Include geographic and device breakdown (default: false)"),
    },
    async ({ stream_id, include_demographics }) => {
      const params = new URLSearchParams();
      if (stream_id) params.set("stream_id", stream_id);
      if (include_demographics) params.set("include_demographics", "true");

      const query = params.toString();
      const path = `/api/v1/analytics/viewers${query ? `?${query}` : ""}`;
      const res = await waveFetch(path);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );

  server.tool(
    "wave_get_stream_metrics",
    "Get detailed performance metrics for a stream including bitrate, latency, quality scores, and error rates",
    {
      stream_id: z.string().uuid().describe("The UUID of the stream"),
      period: z
        .enum(["1h", "6h", "24h", "7d", "30d"])
        .optional()
        .describe("Time period for metrics aggregation (default: 24h)"),
      granularity: z
        .enum(["1m", "5m", "1h", "1d"])
        .optional()
        .describe("Data point granularity (default: 5m)"),
    },
    async ({ stream_id, period, granularity }) => {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (granularity) params.set("granularity", granularity);

      const query = params.toString();
      const path = `/api/v1/analytics/streams/${stream_id}/metrics${query ? `?${query}` : ""}`;
      const res = await waveFetch(path);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );
}
