// WAVE Media Engine transport tools (go-live lane ME-MCP-transport-tools).
//
// Every tool here wraps a GA transport route served by the WAVE Media Engine plane
// (moq, srt, whip/whep, listen, crest, braid, dante-observe, engine). Namespace/track
// identifiers mirror the ^[a-z0-9-]{1,64}$ rule the relay itself enforces (see
// api.wave.online/openapi.json's MoqNamespaceParam/MoqTrackParam) so a malformed
// request fails fast, client-side, with an actionable Zod error instead of a round
// trip. A non-2xx response (most commonly a 402 x402 payment challenge, or 401/403
// scope errors) is surfaced via `structuredErrorContent` — a parsed JSON payload with
// `isError: true` — rather than the flat "Error N: <body>" text `errorContent` uses,
// so a calling agent can branch on `status`/`error.code` without regexing prose.
import { z } from "zod";
import { defineTool, structuredErrorContent, textContent, waveFetch, type WaveToolDef } from "./shared.js";

const nsTrack = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]{1,64}$/, "must be lowercase alphanumeric and dashes, 1-64 characters");

export const transportTools: WaveToolDef[] = [
  // ---------------------------------------------------------------------------
  // MoQ (Media over QUIC)
  // ---------------------------------------------------------------------------
  defineTool({
    name: "wave_mint_moq_publish_token",
    description:
      "Mint a MoQ publish join-token (POST /v1/moq/publish/{ns}/{track}). The relay re-checks " +
      "`ns`/`track` against the token's claims, so both are bound at mint time.",
    inputSchema: {
      ns: nsTrack.describe("MoQ namespace. The same value is bound into the minted token's claims."),
      track: nsTrack.describe("MoQ track name within the namespace."),
      declare_protocol: z
        .string()
        .optional()
        .describe("Optional declared origin protocol for billing (e.g. `moq`), sent as x-wave-declare-protocol. Ignored unless recognized; never rejects the mint."),
    },
    handler: async ({ ns, track, declare_protocol }) => {
      const headers: Record<string, string> = {};
      if (declare_protocol !== undefined) headers["x-wave-declare-protocol"] = declare_protocol;
      const res = await waveFetch(`/v1/moq/publish/${encodeURIComponent(ns)}/${encodeURIComponent(track)}`, {
        method: "POST",
        headers,
      });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_mint_moq_subscribe_token",
    description: "Mint a MoQ subscribe join-token (GET /v1/moq/subscribe/{ns}/{track}).",
    inputSchema: {
      ns: nsTrack.describe("MoQ namespace. The same value is bound into the minted token's claims."),
      track: nsTrack.describe("MoQ track name within the namespace."),
    },
    handler: async ({ ns, track }) => {
      const res = await waveFetch(`/v1/moq/subscribe/${encodeURIComponent(ns)}/${encodeURIComponent(track)}`);
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  // ---------------------------------------------------------------------------
  // Braided audio
  // ---------------------------------------------------------------------------
  defineTool({
    name: "wave_publish_braid_audio",
    description:
      "Publish a braided audio track (POST /v1/braid/publish): interleave named audio sources into " +
      "one multichannel track under a namespace. Republishing the same `ns` replaces the prior machine.",
    inputSchema: {
      ns: z.string().min(1).describe("Namespace for the published track. Republishing the same ns replaces the prior machine."),
      sources: z
        .array(
          z.object({
            label: z.string().min(1).describe("Source label"),
            track: z.string().min(1).describe("Source track name"),
            url: z.string().url().optional().describe("Source URL"),
            path: z.string().optional().describe("Source path (alternative to url)"),
          }),
        )
        .min(1)
        .describe("Named audio sources to braid into one interleaved multichannel track."),
      window_ms: z.number().int().positive().optional().describe("Braid window size in milliseconds (default: machine-config default)"),
      sample_rate: z.number().int().positive().optional().describe("Sample rate for the braided track (default: machine-config default)"),
    },
    handler: async ({ ns, sources, window_ms, sample_rate }) => {
      const payload: Record<string, unknown> = { ns, sources };
      if (window_ms !== undefined) payload["windowMs"] = window_ms;
      if (sample_rate !== undefined) payload["sampleRate"] = sample_rate;
      const res = await waveFetch("/v1/braid/publish", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_stop_braid_audio",
    description: "Stop a braided audio publish (DELETE /v1/braid/publish/{ns}). Destructive: cannot be undone; confirm before calling.",
    inputSchema: {
      ns: z.string().min(1).describe("Namespace of the braid publish to stop"),
    },
    handler: async ({ ns }) => {
      const res = await waveFetch(`/v1/braid/publish/${encodeURIComponent(ns)}`, { method: "DELETE" });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  // ---------------------------------------------------------------------------
  // Engine capability contract
  // ---------------------------------------------------------------------------
  defineTool({
    name: "wave_engine_capabilities",
    description: "The media-engine capability contract (GET /v1/engine/capabilities): which transports, protocols and codecs this account's engine plane currently serves.",
    inputSchema: {},
    handler: async () => {
      const res = await waveFetch("/v1/engine/capabilities");
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  // ---------------------------------------------------------------------------
  // SRT
  // ---------------------------------------------------------------------------
  defineTool({
    name: "wave_create_srt_input",
    description: "Create an SRT input (POST /v1/srt/inputs): provisions an ingest endpoint and returns an input id + SRT URL to point an encoder at.",
    inputSchema: {
      name: z.string().min(1).max(200).optional().describe("Human label for the SRT input"),
      mode: z.enum(["caller", "listener"]).optional().describe("SRT connection mode (default: listener)"),
      passphrase: z.string().min(10).max(79).optional().describe("Optional SRT passphrase for encrypted ingest"),
      latency_ms: z.number().int().min(0).optional().describe("Target SRT latency in milliseconds"),
    },
    handler: async ({ name, mode, passphrase, latency_ms }) => {
      const payload: Record<string, unknown> = {};
      if (name !== undefined) payload["name"] = name;
      if (mode !== undefined) payload["mode"] = mode;
      if (passphrase !== undefined) payload["passphrase"] = passphrase;
      if (latency_ms !== undefined) payload["latencyMs"] = latency_ms;
      const res = await waveFetch("/v1/srt/inputs", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_list_srt_inputs",
    description: "List SRT inputs in your WAVE account (GET /v1/srt/inputs).",
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of inputs to return (default 50)"),
      offset: z.number().int().min(0).optional().describe("Number of inputs to skip for pagination (default 0)"),
    },
    handler: async ({ limit, offset }) => {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set("limit", String(limit));
      if (offset !== undefined) params.set("offset", String(offset));
      const query = params.toString();
      const res = await waveFetch(`/v1/srt/inputs${query ? `?${query}` : ""}`);
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_delete_srt_input",
    description: "Delete an SRT input by its id (DELETE /v1/srt/inputs/{id}). Destructive: cannot be undone; confirm before calling.",
    inputSchema: {
      input_id: z.string().min(1).describe("The SRT input id to delete"),
    },
    handler: async ({ input_id }) => {
      const res = await waveFetch(`/v1/srt/inputs/${encodeURIComponent(input_id)}`, { method: "DELETE" });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  // ---------------------------------------------------------------------------
  // WHIP / WHEP
  // ---------------------------------------------------------------------------
  defineTool({
    name: "wave_whip_publish",
    description: "Publish media via WHIP (POST /v1/whip/publish): send an SDP offer, receive an SDP answer plus the resource `Location` for later teardown.",
    inputSchema: {
      sdp: z.string().min(1).describe("WHIP SDP offer describing the publisher's media"),
      stream: z.string().optional().describe("Optional stream/session identifier to publish under"),
    },
    handler: async ({ sdp, stream }) => {
      const payload: Record<string, unknown> = { sdp };
      if (stream !== undefined) payload["stream"] = stream;
      const res = await waveFetch("/v1/whip/publish", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_whep_subscribe",
    description: "Subscribe to media via WHEP (POST /v1/whep/subscribe): send an SDP offer for playback, receive an SDP answer for the requested stream.",
    inputSchema: {
      sdp: z.string().min(1).describe("WHEP SDP offer describing the viewer's receive capabilities"),
      stream: z.string().min(1).describe("Stream/session identifier to subscribe to"),
    },
    handler: async ({ sdp, stream }) => {
      const res = await waveFetch("/v1/whep/subscribe", { method: "POST", body: JSON.stringify({ sdp, stream }) });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  // ---------------------------------------------------------------------------
  // Listen / Crest (agentic realtime sessions)
  // ---------------------------------------------------------------------------
  defineTool({
    name: "wave_create_listen_session",
    description: "Create a listen session (POST /v1/listen/sessions): attach an agent as a live listener over a supported transport and receive a session id + receive descriptor.",
    inputSchema: {
      stream: z.string().min(1).describe("Stream ref: a whep:// / srt:// URI, a live-input id, or equivalent transport locator"),
      task: z.string().optional().describe("Optional natural-language task describing what to listen for"),
      model: z.string().optional().describe("Optional model id to drive the session (default: account default)"),
    },
    handler: async ({ stream, task, model }) => {
      const payload: Record<string, unknown> = { stream };
      if (task !== undefined) payload["task"] = task;
      if (model !== undefined) payload["model"] = model;
      const res = await waveFetch("/v1/listen/sessions", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  defineTool({
    name: "wave_create_crest_session",
    description: "Create a crest session (POST /v1/crest/sessions): open a realtime processing session bound to a source and receive a session id + receive descriptor.",
    inputSchema: {
      stream: z.string().min(1).describe("Stream ref: a whep:// / srt:// URI, a live-input id, or equivalent transport locator"),
      task: z.string().optional().describe("Optional natural-language task describing what the session should do"),
      model: z.string().optional().describe("Optional model id to drive the session (default: account default)"),
    },
    handler: async ({ stream, task, model }) => {
      const payload: Record<string, unknown> = { stream };
      if (task !== undefined) payload["task"] = task;
      if (model !== undefined) payload["model"] = model;
      const res = await waveFetch("/v1/crest/sessions", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),

  // ---------------------------------------------------------------------------
  // Dante-observe
  // ---------------------------------------------------------------------------
  defineTool({
    name: "wave_get_dante_observe_state",
    description: "Get the current Dante-observe state (GET /v1/dante/observe): observed Dante devices/channels on the bound network segment.",
    inputSchema: {
      node_id: z.string().optional().describe("Optional Dante node/device id to scope the observation to"),
    },
    handler: async ({ node_id }) => {
      const params = new URLSearchParams();
      if (node_id !== undefined) params.set("node_id", node_id);
      const query = params.toString();
      const res = await waveFetch(`/v1/dante/observe${query ? `?${query}` : ""}`);
      if (!res.ok) return structuredErrorContent(res.status, res.body);
      return textContent(res.body);
    },
  }),
];
