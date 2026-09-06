import { z } from "zod";
import { getAuthHeaders, getBaseUrl } from "../auth.js";
import { defineTool, errorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

export const productionTools: WaveToolDef[] = [
  defineTool({
    name: "wave_switch_camera",
    description:
      "Switch the program or preview bus to a different camera index in a multi-camera production (POST /v1/productions/{id}/camera)",
    inputSchema: {
      production_id: z.string().uuid().describe("The production ID"),
      camera_index: z.number().int().min(0).max(15).describe("Camera index to switch to (0-15)"),
      bus: z.enum(["program", "preview"]).describe("Which bus to switch"),
      transition: z
        .enum(["cut", "dissolve", "wipe", "fade"])
        .optional()
        .describe("Transition type (default: cut)"),
    },
    handler: async ({ production_id, camera_index, bus, transition }) => {
      const payload: Record<string, unknown> = { cameraIndex: camera_index, bus };
      if (transition !== undefined) payload["transition"] = transition;

      const res = await waveFetch(`/v1/productions/${encodeURIComponent(production_id)}/camera`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_create_clip",
    description:
      "Create a clip from a recording (POST /v1/clips). `source` is a recording ID; `in` and, optionally, `out`/`duration` are time strings like \"5s\" or \"2m\"",
    inputSchema: {
      source: z.string().min(1).describe("The recording ID to clip from"),
      in: z.string().describe('Clip start offset, a time string like "5s" or "2m" (0-10m)'),
      out: z
        .string()
        .optional()
        .describe('Clip end offset, a time string like "35s". Omit if using `duration`'),
      duration: z
        .string()
        .optional()
        .describe('Clip length, a time string like "30s" (1s-60s). Omit if using `out`'),
      visibility: z
        .enum(["public", "private"])
        .optional()
        .describe("Storage/delivery visibility (default: private)"),
      formats: z
        .array(z.enum(["mp4", "spritesheet", "m4a", "frame"]))
        .optional()
        .describe("Output formats to generate (default: [mp4])"),
      quality: z
        .enum(["720p", "1080p", "4k"])
        .optional()
        .describe("Output quality lane (default: 720p)"),
      width: z.number().int().min(10).max(2000).optional().describe("Output width in px (10-2000)"),
      height: z.number().int().min(10).max(2000).optional().describe("Output height in px (10-2000)"),
      fit: z
        .enum(["contain", "cover", "scale-down"])
        .optional()
        .describe("Resize fit mode (default: contain)"),
      spritesheet_frames: z
        .number()
        .int()
        .min(1)
        .max(120)
        .optional()
        .describe("Frame count for spritesheet output (1-120, default: 30)"),
    },
    handler: async ({
      source,
      in: inStr,
      out,
      duration,
      visibility,
      formats,
      quality,
      width,
      height,
      fit,
      spritesheet_frames,
    }) => {
      const payload: Record<string, unknown> = { source, in: inStr };
      if (out !== undefined) payload["out"] = out;
      if (duration !== undefined) payload["duration"] = duration;
      if (visibility !== undefined) payload["visibility"] = visibility;
      if (formats !== undefined) payload["formats"] = formats;
      if (quality !== undefined) payload["quality"] = quality;
      if (width !== undefined) payload["width"] = width;
      if (height !== undefined) payload["height"] = height;
      if (fit !== undefined) payload["fit"] = fit;
      if (spritesheet_frames !== undefined) payload["spritesheetFrames"] = spritesheet_frames;

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
    description:
      "Show or hide a graphics overlay in a production (POST /v1/productions/{id}/overlay)",
    inputSchema: {
      production_id: z.string().uuid().describe("The production ID"),
      overlay_id: z.string().min(1).max(100).describe("The overlay ID (1-100 chars)"),
      visible: z.boolean().describe("Whether the overlay should be visible"),
    },
    handler: async ({ production_id, overlay_id, visible }) => {
      const res = await waveFetch(`/v1/productions/${encodeURIComponent(production_id)}/overlay`, {
        method: "POST",
        body: JSON.stringify({ overlayId: overlay_id, visible }),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_control_camera",
    description:
      "Send a control command to a managed camera (POST /v1/cameras/{id}/control). `command` selects the variant; supply only the fields that variant needs: set_iris/set_focus/set_zoom/set_gain use `value`; set_white_balance uses `temperature`+`tint`; set_shutter uses `angle`; set_audio_level uses `channel`+`level`; recall_preset uses `preset_id`; save_preset uses `name`+`slot`; start_recording/stop_recording/start_prerecord/autofocus_trigger take no extra fields",
    inputSchema: {
      camera_id: z.string().uuid().describe("The camera ID"),
      command: z
        .enum([
          "set_iris",
          "set_focus",
          "set_zoom",
          "set_white_balance",
          "set_gain",
          "set_shutter",
          "start_recording",
          "stop_recording",
          "start_prerecord",
          "autofocus_trigger",
          "set_audio_level",
          "recall_preset",
          "save_preset",
        ])
        .describe("The camera command variant"),
      value: z.number().optional().describe("Numeric value for set_iris/set_focus/set_zoom/set_gain"),
      temperature: z.number().optional().describe("Color temperature for set_white_balance"),
      tint: z.number().optional().describe("Tint for set_white_balance"),
      angle: z.number().optional().describe("Shutter angle for set_shutter"),
      channel: z.number().optional().describe("Audio channel for set_audio_level"),
      level: z.number().optional().describe("Audio level for set_audio_level"),
      preset_id: z.string().uuid().optional().describe("Preset ID for recall_preset"),
      name: z.string().min(1).optional().describe("Preset name for save_preset"),
      slot: z.number().int().min(1).max(20).optional().describe("Preset slot (1-20) for save_preset"),
    },
    handler: async ({ camera_id, command, value, temperature, tint, angle, channel, level, preset_id, name, slot }) => {
      const payload: Record<string, unknown> = { type: command };
      if (value !== undefined) payload["value"] = value;
      if (temperature !== undefined) payload["temperature"] = temperature;
      if (tint !== undefined) payload["tint"] = tint;
      if (angle !== undefined) payload["angle"] = angle;
      if (channel !== undefined) payload["channel"] = channel;
      if (level !== undefined) payload["level"] = level;
      if (preset_id !== undefined) payload["presetId"] = preset_id;
      if (name !== undefined) payload["name"] = name;
      if (slot !== undefined) payload["slot"] = slot;

      const res = await waveFetch(`/v1/cameras/${encodeURIComponent(camera_id)}/control`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_moderate_chat",
    description: "Moderate a chat message in a live stream (POST /v1/moderate): block, flag, or allow it",
    inputSchema: {
      stream_id: z.string().uuid().describe("The stream ID"),
      message_id: z.string().describe("The chat message ID to moderate"),
      action: z.enum(["block", "flag", "allow"]).describe("Moderation action"),
      reason: z.string().max(500).optional().describe("Reason for moderation action"),
    },
    handler: async ({ stream_id, message_id, action, reason }) => {
      const payload: Record<string, unknown> = { stream_id, message_id, action };
      if (reason !== undefined) payload["reason"] = reason;

      const res = await waveFetch("/v1/moderate", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_start_captions",
    description:
      "Transcribe an audio clip and optionally run a fast-LLM step over the transcript (POST /v1/live/pipeline, multipart). This processes ONE provided audio chunk through WAVE's live pipeline — it does not attach a persistent caption feed to a live stream. Requires the account's live pipeline feature to be enabled; a 404 means it is not armed for this account",
    inputSchema: {
      audio_base64: z.string().min(1).describe("Base64-encoded audio bytes to transcribe (max 25MB decoded)"),
      filename: z.string().optional().describe('Filename hint for the audio (default: "audio.wav")'),
      stream_id: z
        .string()
        .max(128)
        .optional()
        .describe("Client correlation ID for this stream/session (letters, digits, . _ : -, 1-128 chars)"),
      language: z.string().optional().describe("ISO 639 language hint for transcription (transcribe task only)"),
      task: z.enum(["transcribe", "translate"]).optional().describe("Caption task (default: transcribe)"),
      model: z
        .enum(["whisper-large-v3-turbo", "whisper-large-v3"])
        .optional()
        .describe("Transcription model (default: whisper-large-v3-turbo; translate forces whisper-large-v3)"),
      mode: z
        .enum(["summarize", "moderate", "translate", "custom"])
        .optional()
        .describe("Fast-LLM step to run over the transcript (default: summarize)"),
      instruction: z.string().max(500).optional().describe("Custom instruction for mode=custom"),
      llm_model: z.string().min(1).describe("Fast LLM model ID to run the pipeline step"),
      max_tokens: z.number().int().min(1).max(4096).optional().describe("Max tokens for the LLM step (default: 256)"),
    },
    handler: async ({
      audio_base64,
      filename,
      stream_id,
      language,
      task,
      model,
      mode,
      instruction,
      llm_model,
      max_tokens,
    }) => {
      const bytes = Buffer.from(audio_base64, "base64");
      const form = new FormData();
      form.set("file", new Blob([bytes]), filename ?? "audio.wav");
      if (stream_id !== undefined) form.set("stream_id", stream_id);
      if (language !== undefined) form.set("language", language);
      if (task !== undefined) form.set("task", task);
      if (model !== undefined) form.set("model", model);
      if (mode !== undefined) form.set("mode", mode);
      if (instruction !== undefined) form.set("instruction", instruction);
      form.set("llm_model", llm_model);
      if (max_tokens !== undefined) form.set("max_tokens", String(max_tokens));

      const headers = getAuthHeaders();
      delete (headers as Record<string, string>)["Content-Type"];

      const res = await fetch(`${getBaseUrl()}/v1/live/pipeline`, {
        method: "POST",
        headers,
        body: form,
      });
      const body = await res.text();
      if (!res.ok) return errorContent(res.status, body);
      return textContent(body);
    },
  }),
];
