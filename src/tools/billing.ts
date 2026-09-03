import { z } from "zod";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

export const billingTools: WaveToolDef[] = [
  defineTool({
    name: "wave_get_subscription",
    description:
      "Get current subscription details including plan, billing cycle, and feature entitlements",
    inputSchema: {},
    handler: async () => {
      const res = await waveFetch("/v1/billing/subscription");
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_get_usage",
    description:
      "Get current billing period usage including streaming minutes, storage, and bandwidth consumption",
    inputSchema: {
      period: z
        .enum(["current", "previous"])
        .optional()
        .describe("Billing period to query (default: current)"),
      breakdown: z
        .enum(["summary", "daily", "by_stream"])
        .optional()
        .describe("Level of usage detail (default: summary)"),
    },
    handler: async ({ period, breakdown }) => {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (breakdown) params.set("breakdown", breakdown);

      const query = params.toString();
      const path = `/v1/billing/usage${query ? `?${query}` : ""}`;
      const res = await waveFetch(path);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),
];
