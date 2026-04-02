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

export function registerBillingTools(server: McpServer): void {
  server.tool(
    "wave_get_subscription",
    "Get current subscription details including plan, billing cycle, and feature entitlements",
    {},
    async () => {
      const res = await waveFetch("/api/v1/billing/subscription");
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );

  server.tool(
    "wave_get_usage",
    "Get current billing period usage including streaming minutes, storage, and bandwidth consumption",
    {
      period: z
        .enum(["current", "previous"])
        .optional()
        .describe("Billing period to query (default: current)"),
      breakdown: z
        .enum(["summary", "daily", "by_stream"])
        .optional()
        .describe("Level of usage detail (default: summary)"),
    },
    async ({ period, breakdown }) => {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (breakdown) params.set("breakdown", breakdown);

      const query = params.toString();
      const path = `/api/v1/billing/usage${query ? `?${query}` : ""}`;
      const res = await waveFetch(path);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  );
}
