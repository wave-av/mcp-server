// Tests for src/tools/transport.ts — the GA media-engine transport tools.
//
// Each handler is exercised against a monkey-patched `globalThis.fetch` (restored in
// a `finally` after every test, never left dangling for a later test to inherit) so
// no real network call happens and no real WAVE_API_KEY is needed. Two things are
// asserted per tool: (a) it builds the right method + path, and (b) a non-2xx
// response — the 402 x402 challenge an unauthenticated/uncredited call actually gets
// in production — comes back as a STRUCTURED tool error (`isError: true`, JSON body),
// not the flat "Error N: <body>" string the rest of this package's tools use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { transportTools } from "./transport.js";

process.env["WAVE_API_KEY"] = "test-key-not-a-real-credential";
process.env["WAVE_BASE_URL"] = "https://api.wave.online";

function findTool(name: string) {
  const tool = transportTools.find((t) => t.name === name);
  assert.ok(tool, `transport tool not found: ${name}`);
  return tool!;
}

interface Capture {
  url?: string;
  method?: string;
  body?: string;
}

/** Install a fake fetch for the duration of `run`, then always restore the real one. */
async function withFakeFetch<T>(status: number, responseBody: string, run: (capture: Capture) => Promise<T>): Promise<T> {
  const capture: Capture = {};
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    capture.url = String(input);
    capture.method = init?.method ?? "GET";
    capture.body = typeof init?.body === "string" ? init.body : undefined;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => responseBody,
    } as Response;
  }) as typeof fetch;
  try {
    return await run(capture);
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// MoQ
// ---------------------------------------------------------------------------

test("wave_mint_moq_publish_token mints against POST /v1/moq/publish/{ns}/{track}", async () => {
  await withFakeFetch(200, JSON.stringify({ joinToken: "jt_abc" }), async (capture) => {
    const result = await findTool("wave_mint_moq_publish_token").handler({ ns: "studio-a", track: "cam1" });
    assert.equal(capture.method, "POST");
    assert.match(capture.url!, /\/v1\/moq\/publish\/studio-a\/cam1$/);
    assert.match(result.content[0]!.text, /jt_abc/);
    assert.notEqual(result["isError"], true);
  });
});

test("wave_mint_moq_publish_token rejects a namespace outside the relay's charset before ever calling fetch", async () => {
  await assert.rejects(() => findTool("wave_mint_moq_publish_token").handler({ ns: "Not Valid!", track: "cam1" } as never));
});

test("wave_mint_moq_subscribe_token mints against GET /v1/moq/subscribe/{ns}/{track}", async () => {
  await withFakeFetch(200, JSON.stringify({ joinToken: "jt_sub" }), async (capture) => {
    await findTool("wave_mint_moq_subscribe_token").handler({ ns: "studio-a", track: "cam1" });
    assert.equal(capture.method, "GET");
    assert.match(capture.url!, /\/v1\/moq\/subscribe\/studio-a\/cam1$/);
  });
});

// ---------------------------------------------------------------------------
// Braid
// ---------------------------------------------------------------------------

test("wave_publish_braid_audio posts to /v1/braid/publish with sources", async () => {
  await withFakeFetch(201, JSON.stringify({ ns: "mix-1", status: "starting" }), async (capture) => {
    const result = await findTool("wave_publish_braid_audio").handler({
      ns: "mix-1",
      sources: [{ label: "left", track: "l" }],
    });
    assert.equal(capture.method, "POST");
    assert.match(capture.url!, /\/v1\/braid\/publish$/);
    const sent = JSON.parse(capture.body!);
    assert.equal(sent.ns, "mix-1");
    assert.equal(sent.sources.length, 1);
    assert.match(result.content[0]!.text, /starting/);
  });
});

test("wave_stop_braid_audio deletes /v1/braid/publish/{ns}", async () => {
  await withFakeFetch(200, JSON.stringify({ ns: "mix-1", status: "stopped" }), async (capture) => {
    await findTool("wave_stop_braid_audio").handler({ ns: "mix-1" });
    assert.equal(capture.method, "DELETE");
    assert.match(capture.url!, /\/v1\/braid\/publish\/mix-1$/);
  });
});

// ---------------------------------------------------------------------------
// Engine capabilities
// ---------------------------------------------------------------------------

test("wave_engine_capabilities gets /v1/engine/capabilities with no args", async () => {
  await withFakeFetch(200, JSON.stringify({ transports: ["moq", "srt", "whip"] }), async (capture) => {
    const result = await findTool("wave_engine_capabilities").handler({});
    assert.equal(capture.method, "GET");
    assert.match(capture.url!, /\/v1\/engine\/capabilities$/);
    assert.match(result.content[0]!.text, /transports/);
  });
});

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

test("wave_create_srt_input posts to /v1/srt/inputs and returns the input id + SRT URL", async () => {
  await withFakeFetch(200, JSON.stringify({ id: "srt_1", srtUrl: "srt://ingest.wave.online:9000?streamid=srt_1" }), async (capture) => {
    const result = await findTool("wave_create_srt_input").handler({ name: "cam-1" });
    assert.equal(capture.method, "POST");
    assert.match(capture.url!, /\/v1\/srt\/inputs$/);
    assert.match(result.content[0]!.text, /srt_1/);
  });
});

test("wave_list_srt_inputs gets /v1/srt/inputs with pagination params", async () => {
  await withFakeFetch(200, JSON.stringify({ data: [] }), async (capture) => {
    await findTool("wave_list_srt_inputs").handler({ limit: 10, offset: 5 });
    assert.equal(capture.method, "GET");
    assert.match(capture.url!, /\/v1\/srt\/inputs\?limit=10&offset=5$/);
  });
});

test("wave_delete_srt_input deletes /v1/srt/inputs/{id}", async () => {
  await withFakeFetch(200, JSON.stringify({ deleted: true }), async (capture) => {
    await findTool("wave_delete_srt_input").handler({ input_id: "srt_1" });
    assert.equal(capture.method, "DELETE");
    assert.match(capture.url!, /\/v1\/srt\/inputs\/srt_1$/);
  });
});

// ---------------------------------------------------------------------------
// WHIP / WHEP
// ---------------------------------------------------------------------------

test("wave_whip_publish posts an SDP offer to /v1/whip/publish", async () => {
  await withFakeFetch(201, JSON.stringify({ sdp: "v=0...", location: "/v1/whip/publish/res_1" }), async (capture) => {
    const result = await findTool("wave_whip_publish").handler({ sdp: "v=0..." });
    assert.equal(capture.method, "POST");
    assert.match(capture.url!, /\/v1\/whip\/publish$/);
    assert.match(result.content[0]!.text, /location/);
  });
});

test("wave_whep_subscribe posts an SDP offer to /v1/whep/subscribe", async () => {
  await withFakeFetch(201, JSON.stringify({ sdp: "v=0..." }), async (capture) => {
    await findTool("wave_whep_subscribe").handler({ sdp: "v=0...", stream: "cam-1" });
    assert.equal(capture.method, "POST");
    assert.match(capture.url!, /\/v1\/whep\/subscribe$/);
    const sent = JSON.parse(capture.body!);
    assert.equal(sent.stream, "cam-1");
  });
});

// ---------------------------------------------------------------------------
// Listen / Crest
// ---------------------------------------------------------------------------

test("wave_create_listen_session posts to /v1/listen/sessions", async () => {
  await withFakeFetch(200, JSON.stringify({ subscription_id: "lsn_1" }), async (capture) => {
    await findTool("wave_create_listen_session").handler({ stream: "whep://x" });
    assert.equal(capture.method, "POST");
    assert.match(capture.url!, /\/v1\/listen\/sessions$/);
  });
});

test("wave_create_crest_session posts to /v1/crest/sessions", async () => {
  await withFakeFetch(200, JSON.stringify({ session_id: "crest_1" }), async (capture) => {
    await findTool("wave_create_crest_session").handler({ stream: "whep://x" });
    assert.equal(capture.method, "POST");
    assert.match(capture.url!, /\/v1\/crest\/sessions$/);
  });
});

// ---------------------------------------------------------------------------
// Dante-observe
// ---------------------------------------------------------------------------

test("wave_get_dante_observe_state gets /v1/dante/observe", async () => {
  await withFakeFetch(200, JSON.stringify({ devices: [] }), async (capture) => {
    await findTool("wave_get_dante_observe_state").handler({});
    assert.equal(capture.method, "GET");
    assert.match(capture.url!, /\/v1\/dante\/observe$/);
  });
});

// ---------------------------------------------------------------------------
// Structured 402 errors — the marquee failure mode of every one of these tools
// against an unauthenticated/uncredited real call.
// ---------------------------------------------------------------------------

const PAYMENT_REQUIRED_BODY = JSON.stringify({
  error: { code: "PAYMENT_REQUIRED", message: "x402 payment required" },
  accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "1000" }],
});

for (const [name, args] of [
  ["wave_mint_moq_publish_token", { ns: "a", track: "b" }],
  ["wave_mint_moq_subscribe_token", { ns: "a", track: "b" }],
  ["wave_publish_braid_audio", { ns: "a", sources: [{ label: "l", track: "t" }] }],
  ["wave_stop_braid_audio", { ns: "a" }],
  ["wave_engine_capabilities", {}],
  ["wave_create_srt_input", {}],
  ["wave_list_srt_inputs", {}],
  ["wave_delete_srt_input", { input_id: "x" }],
  ["wave_whip_publish", { sdp: "v=0" }],
  ["wave_whep_subscribe", { sdp: "v=0", stream: "x" }],
  ["wave_create_listen_session", { stream: "x" }],
  ["wave_create_crest_session", { stream: "x" }],
  ["wave_get_dante_observe_state", {}],
] as const) {
  test(`${name} surfaces a 402 as a structured tool error (isError: true, parsed JSON)`, async () => {
    await withFakeFetch(402, PAYMENT_REQUIRED_BODY, async () => {
      const result = await findTool(name).handler(args as Record<string, unknown>);
      assert.equal(result["isError"], true);
      const parsed = JSON.parse(result.content[0]!.text);
      assert.equal(parsed.status, 402);
      assert.equal(parsed.error.error.code, "PAYMENT_REQUIRED");
    });
  });
}
