// Regression test for wave-av/mcp-server#91.
//
// Root cause: every one of the 18 published tools (plus the 2 `wave://`
// resources) built requests as `${getBaseUrl()}/api/v1/...` against a default
// base URL of `https://wave.online`. Neither `wave.online` nor
// `api.wave.online` serve `/api/v1/*` — it is an *internal* path shape
// within the WAVE platform, never a path a client should call. Every
// customer using the published package got a prerendered Next.js 404 on
// every call.
//
// Probing (with zero credentials, receipts in issue #91) proved that the
// PUBLIC equivalents at `/v1/*` against `https://api.wave.online` are live
// and gated (402 PAYMENT_REQUIRED for all 18 routes). This test proves,
// without hitting the network, that every tool
// and resource in this package now builds a request against that shape:
// origin `https://api.wave.online`, path prefix `/v1/`, never `/api/v1/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allTools } from "./index.js";

const DUMMY_UUID = "00000000-0000-4000-8000-000000000000";

process.env["WAVE_API_KEY"] = "test-key-not-real";
delete process.env["WAVE_BASE_URL"];

/** Minimal arg fixtures — just enough to satisfy each tool's required fields. */
const ARGS: Record<string, Record<string, unknown>> = {
  wave_list_streams: {},
  wave_create_stream: { title: "t" },
  wave_start_stream: { stream_id: DUMMY_UUID },
  wave_stop_stream: { stream_id: DUMMY_UUID },
  wave_get_stream_health: { stream_id: DUMMY_UUID },
  wave_list_productions: {},
  wave_create_production: { title: "t" },
  wave_get_viewers: {},
  wave_get_stream_metrics: { stream_id: DUMMY_UUID },
  wave_get_subscription: {},
  wave_get_usage: {},
  wave_switch_camera: { switcher_id: DUMMY_UUID, source_id: "cam_1" },
  wave_create_clip: { stream_id: DUMMY_UUID, start_time: 0, end_time: 1 },
  wave_show_graphic: { production_id: DUMMY_UUID, graphic_id: "g1", action: "show" },
  wave_control_camera: { camera_id: DUMMY_UUID, action: "move" },
  wave_moderate_chat: { stream_id: DUMMY_UUID, message_id: "m1", action: "block" },
  wave_start_captions: { stream_id: DUMMY_UUID },
  wave_mark_highlight: { stream_id: DUMMY_UUID },
};

function fakeResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => "{}",
    json: async () => ({}),
    headers: new Headers(),
  } as unknown as Response;
}

test("all 18 tools are declared and every one has a fixture", () => {
  assert.equal(allTools.length, 18, "expected exactly 18 tools (issue #91 / PR #835 tallies)");
  for (const tool of allTools) {
    assert.ok(ARGS[tool.name], `missing arg fixture for tool ${tool.name}`);
  }
});

test("every tool calls the gateway at https://api.wave.online/v1/*, never /api/v1/*", async (t) => {
  for (const tool of allTools) {
    await t.test(tool.name, async () => {
      let capturedUrl: string | undefined;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: string | URL | Request) => {
        capturedUrl = typeof input === "string" ? input : input.toString();
        return fakeResponse();
      }) as typeof fetch;

      try {
        await tool.handler(ARGS[tool.name] ?? {});
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.ok(capturedUrl, `${tool.name} never called fetch()`);
      assert.match(
        capturedUrl!,
        /^https:\/\/api\.wave\.online\/v1\//,
        `${tool.name} called ${capturedUrl}, expected https://api.wave.online/v1/* (got the wrong origin and/or the internal /api/v1 prefix — this is exactly issue #91)`,
      );
      assert.doesNotMatch(
        capturedUrl!,
        /\/api\/v1\//,
        `${tool.name} still uses the internal /api/v1/* prefix instead of the public /v1/* shape`,
      );
    });
  }
});

test("WAVE_BASE_URL override still composes with the /v1/* path shape", async () => {
  process.env["WAVE_BASE_URL"] = "https://staging.wave.online";
  let capturedUrl: string | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    return fakeResponse();
  }) as typeof fetch;

  try {
    const listStreams = allTools.find((t) => t.name === "wave_list_streams");
    assert.ok(listStreams);
    await listStreams.handler({});
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env["WAVE_BASE_URL"];
  }

  assert.match(capturedUrl!, /^https:\/\/staging\.wave\.online\/v1\//);
});
