import { z } from "zod";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

export const analyticsTools: WaveToolDef[] = [
  defineTool({
    name: "wave_get_viewers",
    description: "Get account-wide viewer engagement analytics (GET /v1/analytics/engagement) over an optional date range",
    inputSchema: {
      from: z.string().optional().describe("Range start (ISO 8601 timestamp), optional"),
      to: z.string().optional().describe("Range end (ISO 8601 timestamp), optional"),
    },
    handler: async ({ from, to }) => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const query = params.toString();
      const path = `/v1/analytics/engagement${query ? `?${query}` : ""}`;
      const res = await waveFetch(path);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),
];
