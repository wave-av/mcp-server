import { z } from "zod";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

export const streamTools: WaveToolDef[] = [
  defineTool({
    name: "wave_list_streams",
    description: "List all streams in your WAVE account with pagination support",
    inputSchema: {
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
    handler: async ({ limit, offset, status }) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit ?? 25));
      params.set("offset", String(offset ?? 0));
      if (status && status !== "all") {
        params.set("status", status);
      }

      const res = await waveFetch(`/v1/streams?${params.toString()}`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_create_stream",
    description: "Create a new stream in your WAVE account",
    inputSchema: {
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
    handler: async ({ title, description, protocol, record, region }) => {
      const payload: Record<string, unknown> = { title };
      if (description !== undefined) payload["description"] = description;
      if (protocol !== undefined) payload["protocol"] = protocol;
      if (record !== undefined) payload["record"] = record;
      if (region !== undefined) payload["region"] = region;

      const res = await waveFetch("/v1/streams", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_start_stream",
    description: "Start a stream by its ID, transitioning it to the active state",
    inputSchema: {
      stream_id: z.string().uuid().describe("The UUID of the stream to start"),
    },
    handler: async ({ stream_id }) => {
      const res = await waveFetch(`/v1/streams/${stream_id}/start`, {
        method: "POST",
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_stop_stream",
    description: "Stop an active stream by its ID",
    inputSchema: {
      stream_id: z.string().uuid().describe("The UUID of the stream to stop"),
    },
    handler: async ({ stream_id }) => {
      const res = await waveFetch(`/v1/streams/${stream_id}/stop`, {
        method: "POST",
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_get_stream_health",
    description:
      "Get real-time health metrics for a stream including bitrate, frame rate, and latency",
    inputSchema: {
      stream_id: z.string().uuid().describe("The UUID of the stream to check"),
    },
    handler: async ({ stream_id }) => {
      const res = await waveFetch(`/v1/streams/${stream_id}/health`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),
];
