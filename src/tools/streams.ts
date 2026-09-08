import { z } from "zod";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

export const streamTools: WaveToolDef[] = [
  defineTool({
    name: "wave_list_streams",
    description: "List streams in your WAVE account (GET /v1/streams), with pagination and status filtering",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of streams to return (1-100, default 50)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of streams to skip for pagination (default 0)"),
      status: z
        .enum(["idle", "live", "ended"])
        .optional()
        .describe("Filter by stream status"),
    },
    handler: async ({ limit, offset, status }) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit ?? 50));
      params.set("offset", String(offset ?? 0));
      if (status) {
        params.set("status", status);
      }

      const res = await waveFetch(`/v1/streams?${params.toString()}`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_create_stream",
    description: "Create a new stream (POST /v1/streams) with a Cloudflare Stream live input",
    inputSchema: {
      title: z.string().min(1).max(200).describe("Stream title"),
      description: z.string().max(5000).optional().describe("Stream description"),
      protocol: z
        .enum(["webrtc", "srt", "rtmp", "auto"])
        .optional()
        .describe("Ingest protocol (default: auto)"),
      recording: z
        .object({ enabled: z.boolean() })
        .optional()
        .describe("Recording configuration for this stream"),
      privacy: z.enum(["public", "private"]).optional().describe("Stream visibility (default: public)"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary metadata to attach"),
    },
    handler: async ({ title, description, protocol, recording, privacy, metadata }) => {
      const payload: Record<string, unknown> = { title };
      if (description !== undefined) payload["description"] = description;
      if (protocol !== undefined) payload["protocol"] = protocol;
      if (recording !== undefined) payload["recording"] = recording;
      if (privacy !== undefined) payload["privacy"] = privacy;
      if (metadata !== undefined) payload["metadata"] = metadata;

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
    description: "Start a stream by its ID (POST /v1/streams/{id}/start)",
    inputSchema: {
      stream_id: z.string().uuid().describe("The UUID of the stream to start"),
    },
    handler: async ({ stream_id }) => {
      const res = await waveFetch(`/v1/streams/${encodeURIComponent(stream_id)}/start`, {
        method: "POST",
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_stop_stream",
    description: "Stop an active stream by its ID (POST /v1/streams/{id}/stop)",
    inputSchema: {
      stream_id: z.string().uuid().describe("The UUID of the stream to stop"),
    },
    handler: async ({ stream_id }) => {
      const res = await waveFetch(`/v1/streams/${encodeURIComponent(stream_id)}/stop`, {
        method: "POST",
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_get_stream_health",
    description: "Get the current status document for a stream (GET /v1/streams/{id}/status): connection state, viewer count, and quality indicators",
    inputSchema: {
      stream_id: z.string().uuid().describe("The UUID of the stream to check"),
    },
    handler: async ({ stream_id }) => {
      const res = await waveFetch(`/v1/streams/${encodeURIComponent(stream_id)}/status`);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_get_stream_metrics",
    description: "Get analytics for a single stream (GET /v1/streams/{id}/analytics): views, watch time, and geographic/device breakdown over an optional date range",
    inputSchema: {
      stream_id: z.string().uuid().describe("The UUID of the stream"),
      from: z.string().optional().describe("Range start (ISO 8601 timestamp), optional"),
      to: z.string().optional().describe("Range end (ISO 8601 timestamp), optional"),
    },
    handler: async ({ stream_id, from, to }) => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const query = params.toString();
      const path = `/v1/streams/${encodeURIComponent(stream_id)}/analytics${query ? `?${query}` : ""}`;
      const res = await waveFetch(path);
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_mark_highlight",
    description: "Mark a moment in a stream as a highlight for later clipping (POST /v1/streams/{id}/highlights)",
    inputSchema: {
      stream_id: z.string().uuid().describe("The stream ID"),
      label: z.string().max(255).optional().describe("Label for the highlight"),
      timestamp: z
        .string()
        .optional()
        .describe("ISO 8601 timestamp of the highlight moment (default: now)"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Confidence score (0-1, for AI-detected highlights)"),
      duration_seconds: z
        .number()
        .min(0)
        .optional()
        .describe("Duration of the highlighted moment, in seconds"),
    },
    handler: async ({ stream_id, label, timestamp, confidence, duration_seconds }) => {
      const payload: Record<string, unknown> = {};
      if (label !== undefined) payload["label"] = label;
      payload["timestamp"] = timestamp ?? new Date().toISOString();
      if (confidence !== undefined) payload["confidence"] = confidence;
      if (duration_seconds !== undefined) payload["duration_seconds"] = duration_seconds;

      const res = await waveFetch(`/v1/streams/${encodeURIComponent(stream_id)}/highlights`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),
];
