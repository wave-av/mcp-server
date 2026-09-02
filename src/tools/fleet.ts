// Tools for the gateway-fronted product spokes: voice (TTS), transcribe (STT), and captions.
//
// Every path and parameter here is taken from the spokes' own routers at `origin/main`, not from
// `api-spec/openapi.yaml` — the spec over-declares this surface (wave-av/api-spec#33), and each
// spoke owns its whole `/v1` namespace with an exact-match router that 404s anything else. The
// three real endpoints are:
//
//   POST /v1/voice        wave-voice-edge/src/api.ts     → audio bytes (audio/mpeg)
//   POST /v1/transcribe   wave-transcribe-edge/src/api.ts → JSON transcript
//   POST /v1/captions     wave-captions-edge/src/api.ts   → a caption FILE (VTT/SRT) or JSON cues
//
// AUDIO INPUT IS BY URL. The transcribe/captions spokes accept audio either as a raw request body or
// via a `?url=` the spoke fetches server-side (`wave-transcribe-edge/src/transcribe.ts`,
// `wave-captions-edge/src/source.ts`). MCP tool arguments are JSON, so shipping media bytes through
// them would mean base64 in the model's context — the URL path is the only sane one here, and it is
// how an agent already holds media anyway.
import { z } from "zod";
import { defineTool, errorContent, textContent, gatewayFetch, usageNote, type WaveToolDef } from "./shared.js";

/** STT engines both the transcribe and captions spokes accept (`parseEngine`, shared shape).
 *  `auto` resolves to a concrete engine by payload size — see `resolveAuto` in the transcribe spoke. */
const ENGINE = z.enum(["auto", "whisper", "deepgram", "elevenlabs"]);

/** Build the spoke's query string from the optional knobs it actually reads. */
function audioQuery(args: {
  url: string;
  engine?: string;
  language?: string;
  diarize?: boolean;
  format?: string;
}): string {
  const p = new URLSearchParams({ url: args.url });
  if (args.engine) p.set("engine", args.engine);
  if (args.language) p.set("language", args.language);
  if (args.diarize) p.set("diarize", "true");
  if (args.format) p.set("format", args.format);
  return p.toString();
}

export const fleetTools: WaveToolDef[] = [
  defineTool({
    name: "wave_speak",
    description:
      "Synthesize speech from text with WAVE Voice (POST /v1/voice). Returns a receipt — the audio " +
      "content type, byte size, and billed usage — NOT the audio itself, since raw audio cannot be " +
      "returned through a text tool result. Use the WAVE SDK or a direct API call when you need the " +
      "audio bytes.",
    inputSchema: {
      text: z.string().min(1).describe("The text to synthesize (the spoke caps request length)"),
      voiceId: z.string().optional().describe("Voice to use (defaults to the WAVE default voice)"),
      modelId: z.string().optional().describe("TTS model id (defaults to the multilingual v2 model)"),
    },
    handler: async ({ text, voiceId, modelId }) => {
      const body: Record<string, string> = { text };
      if (voiceId) body["voiceId"] = voiceId;
      if (modelId) body["modelId"] = modelId;

      const res = await gatewayFetch("/v1/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return errorContent(res.status, res.body);

      // `res.body` is audio decoded as text and is therefore meaningless — deliberately not returned.
      // Report only what is true and useful: the format, the size, and what it cost.
      const bytes = Buffer.byteLength(res.body, "utf8");
      return textContent(
        `Speech synthesized: ${res.contentType || "audio"} (~${bytes} bytes).` +
          ` Audio bytes are not returned through MCP — call POST /v1/voice directly to retrieve them.` +
          usageNote(res),
      );
    },
  }),

  defineTool({
    name: "wave_transcribe",
    description:
      "Transcribe audio from a URL with WAVE Transcribe (POST /v1/transcribe). Returns the JSON " +
      "transcript. The spoke fetches the URL itself, so it must be publicly reachable.",
    inputSchema: {
      url: z.string().url().describe("Publicly reachable URL of the audio to transcribe"),
      engine: ENGINE.optional().describe("STT engine (default: auto, chosen by payload size)"),
      language: z.string().optional().describe("BCP-47 language hint, e.g. 'en'"),
      diarize: z.boolean().optional().describe("Label distinct speakers"),
    },
    handler: async ({ url, engine, language, diarize }) => {
      const res = await gatewayFetch(`/v1/transcribe?${audioQuery({ url, engine, language, diarize })}`, {
        method: "POST",
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body + usageNote(res));
    },
  }),

  defineTool({
    name: "wave_caption",
    description:
      "Generate a caption file from audio at a URL with WAVE Captions (POST /v1/captions). Returns " +
      "the caption file itself — WebVTT, SubRip, or JSON cues — as text.",
    inputSchema: {
      url: z.string().url().describe("Publicly reachable URL of the audio to caption"),
      format: z.enum(["vtt", "srt", "json"]).optional().describe("Caption format (default: the spoke's default)"),
      engine: ENGINE.optional().describe("STT engine (default: auto)"),
      language: z.string().optional().describe("BCP-47 language hint, e.g. 'en'"),
    },
    handler: async ({ url, format, engine, language }) => {
      const res = await gatewayFetch(`/v1/captions?${audioQuery({ url, engine, language, format })}`, {
        method: "POST",
      });
      if (!res.ok) return errorContent(res.status, res.body);

      return textContent(res.body + usageNote(res));
    },
  }),
];
