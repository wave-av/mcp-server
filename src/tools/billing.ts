import { z } from "zod";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const billingTools: WaveToolDef[] = [
  defineTool({
    name: "wave_get_subscription",
    description: "Get the current billing account (GET /v1/billing): plan, Stripe customer status, and subscription state",
    inputSchema: {},
    handler: async () => {
      const res = await waveFetch("/v1/billing");
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_get_usage",
    description: "Get billed usage for a date range (GET /v1/billing/usage), defaulting to the current month",
    inputSchema: {
      from: z.string().regex(DATE_RE).optional().describe("Range start (YYYY-MM-DD), default: start of current month"),
      to: z.string().regex(DATE_RE).optional().describe("Range end (YYYY-MM-DD), default: today"),
    },
    handler: async ({ from, to }) => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const query = params.toString();
      const path = `/v1/billing/usage${query ? `?${query}` : ""}`;
      const res = await waveFetch(path);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),
];
