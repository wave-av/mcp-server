#!/usr/bin/env node

// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/tools/streams.ts
import { z } from "zod";

// src/auth.ts
var DEFAULT_BASE_URL = "https://wave.online";
function getApiKey() {
  const key = process.env["WAVE_API_KEY"];
  if (!key) {
    throw new Error(
      "WAVE_API_KEY environment variable is required. Set it to your WAVE API key before starting the MCP server. You can generate one at https://wave.online/settings/api-keys"
    );
  }
  return key;
}
function getBaseUrl() {
  return process.env["WAVE_BASE_URL"] ?? DEFAULT_BASE_URL;
}
function getAuthHeaders() {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
    "User-Agent": "wave-mcp-server/0.1.0"
  };
}

// src/tools/streams.ts
async function waveFetch(path, init) {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...init?.headers
    }
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
function textContent(text) {
  return { content: [{ type: "text", text }] };
}
function errorContent(status, body) {
  return textContent(`Error ${status}: ${body}`);
}
function registerStreamTools(server) {
  server.tool(
    "wave_list_streams",
    "List all streams in your WAVE account with pagination support",
    {
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of streams to return (1-100, default 25)"),
      offset: z.number().int().min(0).optional().describe("Number of streams to skip for pagination (default 0)"),
      status: z.enum(["active", "idle", "error", "all"]).optional().describe("Filter by stream status")
    },
    async ({ limit, offset, status }) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit ?? 25));
      params.set("offset", String(offset ?? 0));
      if (status && status !== "all") {
        params.set("status", status);
      }
      const res = await waveFetch(`/api/v1/streams?${params.toString()}`);
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    }
  );
  server.tool(
    "wave_create_stream",
    "Create a new stream in your WAVE account",
    {
      title: z.string().min(1).max(255).describe("Stream title"),
      description: z.string().max(2e3).optional().describe("Stream description"),
      protocol: z.enum(["webrtc", "srt", "rtmp", "hls"]).optional().describe("Streaming protocol (default: webrtc)"),
      record: z.boolean().optional().describe("Enable recording for this stream (default: false)"),
      region: z.string().optional().describe("Preferred ingest region (e.g., us-east-1, eu-west-1)")
    },
    async ({ title, description, protocol, record, region }) => {
      const payload = { title };
      if (description !== void 0) payload["description"] = description;
      if (protocol !== void 0) payload["protocol"] = protocol;
      if (record !== void 0) payload["record"] = record;
      if (region !== void 0) payload["region"] = region;
      const res = await waveFetch("/api/v1/streams", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    }
  );
  server.tool(
    "wave_start_stream",
    "Start a stream by its ID, transitioning it to the active state",
    {
      stream_id: z.string().uuid().describe("The UUID of the stream to start")
    },
    async ({ stream_id }) => {
      const res = await waveFetch(`/api/v1/streams/${stream_id}/start`, {
        method: "POST"
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    }
  );
  server.tool(
    "wave_stop_stream",
    "Stop an active stream by its ID",
    {
      stream_id: z.string().uuid().describe("The UUID of the stream to stop")
    },
    async ({ stream_id }) => {
      const res = await waveFetch(`/api/v1/streams/${stream_id}/stop`, {
        method: "POST"
      });
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    }
  );
  server.tool(
    "wave_get_stream_health",
    "Get real-time health metrics for a stream including bitrate, frame rate, and latency",
    {
      stream_id: z.string().uuid().describe("The UUID of the stream to check")
    },
    async ({ stream_id }) => {
      const res = await waveFetch(`/api/v1/streams/${stream_id}/health`);
      if (!res.ok) return errorContent(res.status, res.body);
      return textContent(res.body);
    }
  );
}

// src/tools/studio.ts
import { z as z2 } from "zod";
async function waveFetch2(path, init) {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...init?.headers
    }
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
function textContent2(text) {
  return { content: [{ type: "text", text }] };
}
function errorContent2(status, body) {
  return textContent2(`Error ${status}: ${body}`);
}
function registerStudioTools(server) {
  server.tool(
    "wave_list_productions",
    "List all studio productions in your WAVE account",
    {
      limit: z2.number().int().min(1).max(100).optional().describe("Maximum number of productions to return (1-100, default 25)"),
      offset: z2.number().int().min(0).optional().describe("Number of productions to skip for pagination (default 0)"),
      status: z2.enum(["draft", "live", "ended", "all"]).optional().describe("Filter by production status")
    },
    async ({ limit, offset, status }) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit ?? 25));
      params.set("offset", String(offset ?? 0));
      if (status && status !== "all") {
        params.set("status", status);
      }
      const res = await waveFetch2(`/api/v1/studio/productions?${params.toString()}`);
      if (!res.ok) return errorContent2(res.status, res.body);
      return textContent2(res.body);
    }
  );
  server.tool(
    "wave_create_production",
    "Create a new studio production with multi-camera support",
    {
      title: z2.string().min(1).max(255).describe("Production title"),
      description: z2.string().max(2e3).optional().describe("Production description"),
      layout: z2.enum(["single", "split", "pip", "grid", "custom"]).optional().describe("Initial layout mode (default: single)"),
      stream_ids: z2.array(z2.string().uuid()).optional().describe("Stream IDs to include as sources in the production"),
      record: z2.boolean().optional().describe("Enable recording for this production (default: false)")
    },
    async ({ title, description, layout, stream_ids, record }) => {
      const payload = { title };
      if (description !== void 0) payload["description"] = description;
      if (layout !== void 0) payload["layout"] = layout;
      if (stream_ids !== void 0) payload["stream_ids"] = stream_ids;
      if (record !== void 0) payload["record"] = record;
      const res = await waveFetch2("/api/v1/studio/productions", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (!res.ok) return errorContent2(res.status, res.body);
      return textContent2(res.body);
    }
  );
}

// src/tools/analytics.ts
import { z as z3 } from "zod";
async function waveFetch3(path, init) {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...init?.headers
    }
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
function textContent3(text) {
  return { content: [{ type: "text", text }] };
}
function errorContent3(status, body) {
  return textContent3(`Error ${status}: ${body}`);
}
function registerAnalyticsTools(server) {
  server.tool(
    "wave_get_viewers",
    "Get current viewer count and viewer demographics for a stream or across all streams",
    {
      stream_id: z3.string().uuid().optional().describe("Stream ID to get viewers for. Omit for account-wide totals."),
      include_demographics: z3.boolean().optional().describe("Include geographic and device breakdown (default: false)")
    },
    async ({ stream_id, include_demographics }) => {
      const params = new URLSearchParams();
      if (stream_id) params.set("stream_id", stream_id);
      if (include_demographics) params.set("include_demographics", "true");
      const query = params.toString();
      const path = `/api/v1/analytics/viewers${query ? `?${query}` : ""}`;
      const res = await waveFetch3(path);
      if (!res.ok) return errorContent3(res.status, res.body);
      return textContent3(res.body);
    }
  );
  server.tool(
    "wave_get_stream_metrics",
    "Get detailed performance metrics for a stream including bitrate, latency, quality scores, and error rates",
    {
      stream_id: z3.string().uuid().describe("The UUID of the stream"),
      period: z3.enum(["1h", "6h", "24h", "7d", "30d"]).optional().describe("Time period for metrics aggregation (default: 24h)"),
      granularity: z3.enum(["1m", "5m", "1h", "1d"]).optional().describe("Data point granularity (default: 5m)")
    },
    async ({ stream_id, period, granularity }) => {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (granularity) params.set("granularity", granularity);
      const query = params.toString();
      const path = `/api/v1/analytics/streams/${stream_id}/metrics${query ? `?${query}` : ""}`;
      const res = await waveFetch3(path);
      if (!res.ok) return errorContent3(res.status, res.body);
      return textContent3(res.body);
    }
  );
}

// src/tools/billing.ts
import { z as z4 } from "zod";
async function waveFetch4(path, init) {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...init?.headers
    }
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
function textContent4(text) {
  return { content: [{ type: "text", text }] };
}
function errorContent4(status, body) {
  return textContent4(`Error ${status}: ${body}`);
}
function registerBillingTools(server) {
  server.tool(
    "wave_get_subscription",
    "Get current subscription details including plan, billing cycle, and feature entitlements",
    {},
    async () => {
      const res = await waveFetch4("/api/v1/billing/subscription");
      if (!res.ok) return errorContent4(res.status, res.body);
      return textContent4(res.body);
    }
  );
  server.tool(
    "wave_get_usage",
    "Get current billing period usage including streaming minutes, storage, and bandwidth consumption",
    {
      period: z4.enum(["current", "previous"]).optional().describe("Billing period to query (default: current)"),
      breakdown: z4.enum(["summary", "daily", "by_stream"]).optional().describe("Level of usage detail (default: summary)")
    },
    async ({ period, breakdown }) => {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      if (breakdown) params.set("breakdown", breakdown);
      const query = params.toString();
      const path = `/api/v1/billing/usage${query ? `?${query}` : ""}`;
      const res = await waveFetch4(path);
      if (!res.ok) return errorContent4(res.status, res.body);
      return textContent4(res.body);
    }
  );
}

// src/tools/production.ts
import { z as z5 } from "zod";
async function waveFetch5(path, init) {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...getAuthHeaders(),
      ...init?.headers
    }
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
function textContent5(text) {
  return { content: [{ type: "text", text }] };
}
function errorContent5(status, body) {
  return textContent5(`Error ${status}: ${body}`);
}
function registerProductionTools(server) {
  server.tool(
    "wave_switch_camera",
    "Switch the live program output to a different camera/source in a Cloud Switcher session",
    {
      switcher_id: z5.string().uuid().describe("The Cloud Switcher session ID"),
      source_id: z5.string().describe("The source to switch to (e.g., cam_1, screen_share)"),
      transition: z5.enum(["cut", "mix", "wipe", "dve"]).optional().describe("Transition type (default: cut)"),
      duration_ms: z5.number().int().min(0).max(5e3).optional().describe("Transition duration in ms (default: 0 for cut)")
    },
    async ({ switcher_id, source_id, transition, duration_ms }) => {
      const res = await waveFetch5(`/api/v1/switcher/${switcher_id}/control`, {
        method: "POST",
        body: JSON.stringify({
          type: "switch",
          sourceId: source_id,
          transition: transition ?? "cut",
          durationMs: duration_ms ?? 0
        })
      });
      if (!res.ok) return errorContent5(res.status, res.body);
      return textContent5(res.body);
    }
  );
  server.tool(
    "wave_create_clip",
    "Create a clip from a recorded stream, optionally exporting to social platforms",
    {
      stream_id: z5.string().uuid().describe("The stream ID to clip from"),
      start_time: z5.number().min(0).describe("Clip start time in seconds"),
      end_time: z5.number().min(0).describe("Clip end time in seconds"),
      title: z5.string().max(255).optional().describe("Clip title"),
      export_to: z5.array(z5.enum(["tiktok", "youtube_shorts", "instagram_reels", "twitter"])).optional().describe("Social platforms to auto-export to")
    },
    async ({ stream_id, start_time, end_time, title, export_to }) => {
      const payload = {
        streamId: stream_id,
        startTime: start_time,
        endTime: end_time
      };
      if (title !== void 0) payload["title"] = title;
      if (export_to !== void 0) payload["exportTo"] = export_to;
      const res = await waveFetch5("/api/v1/clips", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (!res.ok) return errorContent5(res.status, res.body);
      return textContent5(res.body);
    }
  );
  server.tool(
    "wave_show_graphic",
    "Show or hide an HTML5 graphics overlay on a production",
    {
      production_id: z5.string().uuid().describe("The production ID"),
      graphic_id: z5.string().describe("The graphic template ID"),
      action: z5.enum(["show", "hide", "update"]).describe("Action to perform"),
      data: z5.record(z5.string(), z5.unknown()).optional().describe("Data bindings for the graphic template")
    },
    async ({ production_id, graphic_id, action, data }) => {
      const res = await waveFetch5(
        `/api/v1/studio/productions/${production_id}/graphics/${graphic_id}`,
        {
          method: "POST",
          body: JSON.stringify({ action, data: data ?? {} })
        }
      );
      if (!res.ok) return errorContent5(res.status, res.body);
      return textContent5(res.body);
    }
  );
  server.tool(
    "wave_control_camera",
    "Control a PTZ camera (pan, tilt, zoom, focus, recall preset)",
    {
      camera_id: z5.string().uuid().describe("The camera ID"),
      action: z5.enum(["move", "zoom", "focus", "recall_preset", "store_preset"]).describe("Camera control action"),
      pan: z5.number().min(-1).max(1).optional().describe("Pan speed (-1 to 1)"),
      tilt: z5.number().min(-1).max(1).optional().describe("Tilt speed (-1 to 1)"),
      zoom: z5.number().min(-1).max(1).optional().describe("Zoom speed (-1 to 1)"),
      preset_id: z5.string().optional().describe("Preset ID for recall/store")
    },
    async ({ camera_id, action, pan, tilt, zoom, preset_id }) => {
      const payload = { type: action };
      if (pan !== void 0) payload["pan"] = pan;
      if (tilt !== void 0) payload["tilt"] = tilt;
      if (zoom !== void 0) payload["zoom"] = zoom;
      if (preset_id !== void 0) payload["presetId"] = preset_id;
      const res = await waveFetch5(`/api/v1/cameras/${camera_id}/control`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (!res.ok) return errorContent5(res.status, res.body);
      return textContent5(res.body);
    }
  );
  server.tool(
    "wave_moderate_chat",
    "Moderate a chat message in a live stream (block, flag, or allow)",
    {
      stream_id: z5.string().uuid().describe("The stream ID"),
      message_id: z5.string().describe("The chat message ID to moderate"),
      action: z5.enum(["block", "flag", "allow"]).describe("Moderation action"),
      reason: z5.string().max(500).optional().describe("Reason for moderation action")
    },
    async ({ stream_id, message_id, action, reason }) => {
      const res = await waveFetch5(
        `/api/v1/streams/${stream_id}/chat/${message_id}/moderate`,
        {
          method: "POST",
          body: JSON.stringify({ action, reason: reason ?? "" })
        }
      );
      if (!res.ok) return errorContent5(res.status, res.body);
      return textContent5(res.body);
    }
  );
  server.tool(
    "wave_start_captions",
    "Start real-time captions/transcription on a stream",
    {
      stream_id: z5.string().uuid().describe("The stream ID"),
      language: z5.string().length(2).optional().describe("ISO 639-1 language code (default: en)"),
      provider: z5.enum(["deepgram", "assemblyai", "cohere"]).optional().describe("Transcription provider (default: deepgram)")
    },
    async ({ stream_id, language, provider }) => {
      const res = await waveFetch5(`/api/v1/streams/${stream_id}/captions/start`, {
        method: "POST",
        body: JSON.stringify({
          language: language ?? "en",
          provider: provider ?? "deepgram"
        })
      });
      if (!res.ok) return errorContent5(res.status, res.body);
      return textContent5(res.body);
    }
  );
  server.tool(
    "wave_mark_highlight",
    "Mark a moment in a stream as a highlight for later clipping",
    {
      stream_id: z5.string().uuid().describe("The stream ID"),
      label: z5.string().max(255).optional().describe("Label for the highlight"),
      confidence: z5.number().min(0).max(1).optional().describe("Confidence score (0-1, for AI-detected highlights)")
    },
    async ({ stream_id, label, confidence }) => {
      const res = await waveFetch5(`/api/v1/streams/${stream_id}/highlights`, {
        method: "POST",
        body: JSON.stringify({
          label: label ?? "Highlight",
          confidence: confidence ?? 1,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        })
      });
      if (!res.ok) return errorContent5(res.status, res.body);
      return textContent5(res.body);
    }
  );
}

// src/resources/streams.ts
function registerStreamResources(server) {
  server.resource(
    "stream",
    "wave://streams/{id}",
    {
      description: "A WAVE stream with its configuration and status",
      mimeType: "application/json"
    },
    async (uri) => {
      const id = uri.pathname.split("/").pop();
      if (!id) {
        return {
          contents: [{ uri: uri.href, text: "Error: Missing stream ID", mimeType: "text/plain" }]
        };
      }
      const res = await fetch(`${getBaseUrl()}/api/v1/streams/${id}`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        return {
          contents: [
            {
              uri: uri.href,
              text: `Error ${res.status}: ${await res.text()}`,
              mimeType: "text/plain"
            }
          ]
        };
      }
      const data = await res.json();
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(data, null, 2), mimeType: "application/json" }
        ]
      };
    }
  );
}

// src/resources/productions.ts
function registerProductionResources(server) {
  server.resource(
    "production",
    "wave://productions/{id}",
    { description: "A WAVE studio production session", mimeType: "application/json" },
    async (uri) => {
      const id = uri.pathname.split("/").pop();
      if (!id) {
        return {
          contents: [
            { uri: uri.href, text: "Error: Missing production ID", mimeType: "text/plain" }
          ]
        };
      }
      const res = await fetch(`${getBaseUrl()}/api/v1/productions/${id}`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        return {
          contents: [
            {
              uri: uri.href,
              text: `Error ${res.status}: ${await res.text()}`,
              mimeType: "text/plain"
            }
          ]
        };
      }
      const data = await res.json();
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(data, null, 2), mimeType: "application/json" }
        ]
      };
    }
  );
}

// src/server.ts
async function startServer() {
  const server = new McpServer({
    name: "wave-mcp-server",
    version: "0.1.0"
  });
  registerStreamTools(server);
  registerStudioTools(server);
  registerAnalyticsTools(server);
  registerBillingTools(server);
  registerProductionTools(server);
  registerStreamResources(server);
  registerProductionResources(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[wave-mcp-server] Connected via stdio transport\n");
}

// src/index.ts
startServer().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error during startup";
  process.stderr.write(`[wave-mcp-server] Fatal: ${message}
`);
  process.exit(1);
});
//# sourceMappingURL=index.js.map