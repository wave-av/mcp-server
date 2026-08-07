import { z } from "zod";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

export const productionTools: WaveToolDef[] = [
  defineTool({
    name: "wave_switch_camera",
    description:
      "Switch the live program output to a different camera/source in a Cloud Switcher session",
    inputSchema: {
      switcher_id: z.string().uuid().describe("The Cloud Switcher session ID"),
      source_id: z.string().describe("The source to switch to (e.g., cam_1, screen_share)"),
      transition: z
        .enum(["cut", "mix", "wipe", "dve"])
        .optional()
        .describe("Transition type (default: cut)"),
      duration_ms: z
        .number()
        .int()
        .min(0)
        .max(5000)
        .optional()
        .describe("Transition duration in ms (default: 0 for cut)"),
    },
    handler: async ({ switcher_id, source_id, transition, duration_ms }) => {
      const res = await waveFetch(`/v1/switcher/${switcher_id}/control`, {
        method: "POST",
        body: JSON.stringify({
          type: "switch",
          sourceId: source_id,
          transition: transition ?? "cut",
          durationMs: duration_ms ?? 0,
        }),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_create_clip",
    description: "Create a clip from a recorded stream, optionally exporting to social platforms",
    inputSchema: {
      stream_id: z.string().uuid().describe("The stream ID to clip from"),
      start_time: z.number().min(0).describe("Clip start time in seconds"),
      end_time: z.number().min(0).describe("Clip end time in seconds"),
      title: z.string().max(255).optional().describe("Clip title"),
      export_to: z
        .array(z.enum(["tiktok", "youtube_shorts", "instagram_reels", "twitter"]))
        .optional()
        .describe("Social platforms to auto-export to"),
    },
    handler: async ({ stream_id, start_time, end_time, title, export_to }) => {
      const payload: Record<string, unknown> = {
        streamId: stream_id,
        startTime: start_time,
        endTime: end_time,
      };
      if (title !== undefined) payload["title"] = title;
      if (export_to !== undefined) payload["exportTo"] = export_to;

      const res = await waveFetch("/v1/clips", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_show_graphic",
    description: "Show or hide an HTML5 graphics overlay on a production",
    inputSchema: {
      production_id: z.string().uuid().describe("The production ID"),
      graphic_id: z.string().describe("The graphic template ID"),
      action: z.enum(["show", "hide", "update"]).describe("Action to perform"),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Data bindings for the graphic template"),
    },
    handler: async ({ production_id, graphic_id, action, data }) => {
      const res = await waveFetch(
        `/v1/studio/productions/${production_id}/graphics/${graphic_id}`,
        {
          method: "POST",
          body: JSON.stringify({ action, data: data ?? {} }),
        },
      );
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_control_camera",
    description: "Control a PTZ camera (pan, tilt, zoom, focus, recall preset)",
    inputSchema: {
      camera_id: z.string().uuid().describe("The camera ID"),
      action: z
        .enum(["move", "zoom", "focus", "recall_preset", "store_preset"])
        .describe("Camera control action"),
      pan: z.number().min(-1).max(1).optional().describe("Pan speed (-1 to 1)"),
      tilt: z.number().min(-1).max(1).optional().describe("Tilt speed (-1 to 1)"),
      zoom: z.number().min(-1).max(1).optional().describe("Zoom speed (-1 to 1)"),
      preset_id: z.string().optional().describe("Preset ID for recall/store"),
    },
    handler: async ({ camera_id, action, pan, tilt, zoom, preset_id }) => {
      const payload: Record<string, unknown> = { type: action };
      if (pan !== undefined) payload["pan"] = pan;
      if (tilt !== undefined) payload["tilt"] = tilt;
      if (zoom !== undefined) payload["zoom"] = zoom;
      if (preset_id !== undefined) payload["presetId"] = preset_id;

      const res = await waveFetch(`/v1/cameras/${camera_id}/control`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_moderate_chat",
    description: "Moderate a chat message in a live stream (block, flag, or allow)",
    inputSchema: {
      stream_id: z.string().uuid().describe("The stream ID"),
      message_id: z.string().describe("The chat message ID to moderate"),
      action: z.enum(["block", "flag", "allow"]).describe("Moderation action"),
      reason: z.string().max(500).optional().describe("Reason for moderation action"),
    },
    handler: async ({ stream_id, message_id, action, reason }) => {
      const res = await waveFetch(`/v1/streams/${stream_id}/chat/${message_id}/moderate`, {
        method: "POST",
        body: JSON.stringify({ action, reason: reason ?? "" }),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_start_captions",
    description: "Start real-time captions/transcription on a stream",
    inputSchema: {
      stream_id: z.string().uuid().describe("The stream ID"),
      language: z.string().length(2).optional().describe("ISO 639-1 language code (default: en)"),
      provider: z
        .enum(["deepgram", "assemblyai", "cohere"])
        .optional()
        .describe("Transcription provider (default: deepgram)"),
    },
    handler: async ({ stream_id, language, provider }) => {
      const res = await waveFetch(`/v1/streams/${stream_id}/captions/start`, {
        method: "POST",
        body: JSON.stringify({
          language: language ?? "en",
          provider: provider ?? "deepgram",
        }),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_mark_highlight",
    description: "Mark a moment in a stream as a highlight for later clipping",
    inputSchema: {
      stream_id: z.string().uuid().describe("The stream ID"),
      label: z.string().max(255).optional().describe("Label for the highlight"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Confidence score (0-1, for AI-detected highlights)"),
    },
    handler: async ({ stream_id, label, confidence }) => {
      const res = await waveFetch(`/v1/streams/${stream_id}/highlights`, {
        method: "POST",
        body: JSON.stringify({
          label: label ?? "Highlight",
          confidence: confidence ?? 1.0,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),
];
