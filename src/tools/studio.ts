import { z } from "zod";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

export const studioTools: WaveToolDef[] = [
  defineTool({
    name: "wave_list_productions",
    description: "List all studio productions in your WAVE account",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of productions to return (1-100, default 25)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of productions to skip for pagination (default 0)"),
      status: z
        .enum(["draft", "live", "ended", "all"])
        .optional()
        .describe("Filter by production status"),
    },
    handler: async ({ limit, offset, status }) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit ?? 25));
      params.set("offset", String(offset ?? 0));
      if (status && status !== "all") {
        params.set("status", status);
      }

      const res = await waveFetch(`/api/v1/studio/productions?${params.toString()}`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_create_production",
    description: "Create a new studio production with multi-camera support",
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

      const res = await waveFetch("/api/v1/studio/productions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),
];
