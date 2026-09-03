import { z } from "zod";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

export const studioTools: WaveToolDef[] = [
  defineTool({
    name: "wave_list_productions",
    description: "List multi-camera productions in your WAVE account (GET /v1/productions)",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of productions to return (default 25)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of productions to skip for pagination (default 0)"),
      status: z
        .enum(["setup", "rehearsal", "live", "paused", "ended"])
        .optional()
        .describe("Filter by production status"),
    },
    handler: async ({ limit, offset, status }) => {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set("limit", String(limit));
      if (offset !== undefined) params.set("offset", String(offset));
      if (status) params.set("status", status);

      const query = params.toString();
      const res = await waveFetch(`/v1/productions${query ? `?${query}` : ""}`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_create_production",
    description: "Create a new multi-camera production (POST /v1/productions)",
    inputSchema: {
      title: z.string().min(1).max(255).describe("Production title"),
      description: z.string().max(2000).optional().describe("Production description"),
      layout: z
        .enum(["single", "split", "pip", "grid", "custom"])
        .optional()
        .describe("Initial layout mode (default: single)"),
      stream_ids: z
        .array(z.string().uuid())
        .optional()
        .describe("Stream IDs to include as sources in the production"),
      record: z
        .boolean()
        .optional()
        .describe("Enable recording for this production (default: false)"),
    },
    handler: async ({ title, description, layout, stream_ids, record }) => {
      const payload: Record<string, unknown> = { title };
      if (description !== undefined) payload["description"] = description;
      if (layout !== undefined) payload["layout"] = layout;
      if (stream_ids !== undefined) payload["stream_ids"] = stream_ids;
      if (record !== undefined) payload["record"] = record;

      const res = await waveFetch("/v1/productions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),
];
