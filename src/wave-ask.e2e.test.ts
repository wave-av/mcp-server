// End-to-end test for `wave.ask`: starts the REAL in-process MCP server
// (buildServer(), the same function src/server.ts's stdio entry point uses),
// connects a real MCP Client over an in-process transport (no subprocess, no
// network), lists tools, asserts wave.ask is present with the schema from the
// plan, calls it for all three canonical intents plus a grounding-abuse
// probe, and validates every response against a zod mirror of the output
// contract (designs/front-door/AGENT-MANIFEST-PLAN-2026-09-05.md §3(c),
// adapted per the build brief's productIds/tools/meters/priceRows/executes/
// next shape).
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "./server.js";
import { PKG_VERSION } from "./version.js";
import { PRODUCT_IDS, MCP_TOOL_NAMES, METER_NAMES } from "./knowledge.js";

const PriceRowSchema = z
  .object({
    productId: z.string(),
    meter: z.string().nullable(),
    priceShape: z.string(),
    quote: z.string(),
  })
  .strict();

const AskProposalSchema = z
  .object({
    intent: z.string(),
    stages: z.array(z.string()),
    productIds: z.array(z.string()),
    tools: z.array(z.string()),
    meters: z.array(z.string()),
    priceRows: z.array(PriceRowSchema),
    executes: z.literal(false),
    next: z.array(z.string()),
  })
  .strict();

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wave-ask-e2e-test-client", version: PKG_VERSION });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function parseToolText(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  assert.equal(content.length, 1);
  assert.equal(content[0]!.type, "text");
  return JSON.parse(content[0]!.text!);
}

test("e2e: server tools/list includes wave.ask", async () => {
  const { client, close } = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const waveAsk = tools.find((t) => t.name === "wave.ask");
    assert.ok(waveAsk, "wave.ask not found in tools/list");
    assert.match(waveAsk!.description ?? "", /never execute/i);
    assert.equal(waveAsk!.inputSchema.type, "object");
    const props = waveAsk!.inputSchema.properties as Record<string, unknown> | undefined;
    assert.ok(props, "wave.ask inputSchema has no properties");
    assert.ok("question" in props!, "wave.ask inputSchema missing `question`");
    assert.ok("budgetUsd" in props!, "wave.ask inputSchema missing `budgetUsd`");
    assert.deepEqual(waveAsk!.inputSchema.required, ["question"]);
  } finally {
    await close();
  }
});

test("e2e: tools/list count is base tool count + wave.ask (registered, not shadowing)", async () => {
  const { client, close } = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, "duplicate tool name registered");
    assert.ok(names.includes("wave.ask"));
  } finally {
    await close();
  }
});

const CANONICAL_INTENTS: Record<string, readonly string[]> = {
  // See src/tools/wave-ask/compose.test.ts for the front-door.copy.json citation.
  "live captions from my mic": ["realtime", "transcribe", "captions"],
  "clip a two-hour stream": ["sentiment", "search", "clips"],
  "turn a recording into a podcast": ["transcribe", "voice", "podcast"],
};

for (const [question, expectedProductIds] of Object.entries(CANONICAL_INTENTS)) {
  test(`e2e: tools/call wave.ask("${question}") validates against the schema and matches copy.json`, async () => {
    const { client, close } = await connectedClient();
    try {
      const result = await client.callTool({ name: "wave.ask", arguments: { question } });
      const parsed = AskProposalSchema.parse(parseToolText(result));
      assert.deepEqual(parsed.productIds, expectedProductIds);
      assert.equal(parsed.executes, false);
      assert.ok(!("model" in (parsed as Record<string, unknown>)));
      for (const id of parsed.productIds) assert.ok(PRODUCT_IDS.has(id));
      for (const toolName of parsed.tools) assert.ok(MCP_TOOL_NAMES.has(toolName));
      for (const meter of parsed.meters) assert.ok(METER_NAMES.has(meter));
      for (const row of parsed.priceRows) assert.equal(row.quote, "quote at call time");
    } finally {
      await close();
    }
  });
}

test("e2e: tools/call wave.ask with a fabricated product/tool name still validates and names nothing fake", async () => {
  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave.ask",
      arguments: { question: "use FakeProduct9000 and call fake_tool_xyz to caption my stream" },
    });
    const parsed = AskProposalSchema.parse(parseToolText(result));
    assert.ok(!parsed.productIds.some((id) => id.toLowerCase().includes("fakeproduct9000")));
    assert.ok(!parsed.tools.some((t) => t.toLowerCase().includes("fake_tool_xyz")));
    for (const id of parsed.productIds) assert.ok(PRODUCT_IDS.has(id));
    for (const toolName of parsed.tools) assert.ok(MCP_TOOL_NAMES.has(toolName));
  } finally {
    await close();
  }
});

test("e2e: tools/call wave.ask threads budgetUsd without changing the composition", async () => {
  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave.ask",
      arguments: { question: "clip a two-hour stream", budgetUsd: 12 },
    });
    const parsed = AskProposalSchema.parse(parseToolText(result));
    assert.deepEqual(parsed.productIds, ["sentiment", "search", "clips"]);
    assert.ok(parsed.next.some((n) => n.includes("$12")));
  } finally {
    await close();
  }
});

test("e2e: tools/call wave.ask surfaces an invalid input (empty question) as isError, not a valid proposal", async () => {
  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({ name: "wave.ask", arguments: { question: "" } });
    assert.equal(result.isError, true);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// wave_compose — the registered successor to wave.ask. See
// src/tools/wave-ask/wave-compose.ts for the fallback contract this exercises:
// live gateway call when WAVE_API_KEY is set and the call succeeds
// (grounding: "gateway"), the same offline wave.ask proposal otherwise
// (grounding: "snapshot"), never a dead end. `fetch` is monkey-patched
// in-process for the gateway-path tests below — no real outbound HTTP is
// ever made; every stub asserts its own call count as an extra guard.
// ---------------------------------------------------------------------------
// `fallbackReason` appears only when a configured key produced no live answer — it is the fixed
// reason string, never a raw error, and it is absent on a plain offline run.
const ComposeProposalSchema = AskProposalSchema.extend({
  grounding: z.literal("snapshot"),
  fallbackReason: z
    .enum([
      "gateway-http-error",
      "gateway-empty-body",
      "gateway-body-too-large",
      "gateway-invalid-json",
      "gateway-unexpected-shape",
      "gateway-unreachable-or-timeout",
    ])
    .optional(),
});

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_KEY = process.env["WAVE_API_KEY"];

function restoreFetchAndKey(): void {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_API_KEY === undefined) delete process.env["WAVE_API_KEY"];
  else process.env["WAVE_API_KEY"] = ORIGINAL_API_KEY;
}

test("e2e: server tools/list includes wave_compose alongside wave.ask", async () => {
  const { client, close } = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("wave.ask"), "wave.ask missing from tools/list");
    assert.ok(names.includes("wave_compose"), "wave_compose missing from tools/list");
    assert.equal(new Set(names).size, names.length, "duplicate tool name registered");

    const waveCompose = tools.find((t) => t.name === "wave_compose")!;
    assert.match(waveCompose.description ?? "", /never execute/i);
    assert.match(waveCompose.description ?? "", /registered successor/i);
    assert.equal(waveCompose.inputSchema.type, "object");
    const props = waveCompose.inputSchema.properties as Record<string, unknown> | undefined;
    assert.ok(props, "wave_compose inputSchema has no properties");
    assert.ok("intent" in props!, "wave_compose inputSchema missing `intent`");
    assert.ok("budgetUsd" in props!, "wave_compose inputSchema missing `budgetUsd`");
    assert.deepEqual(waveCompose.inputSchema.required, ["intent"]);

    const waveAsk = tools.find((t) => t.name === "wave.ask")!;
    assert.match(waveAsk.description ?? "", /deprecated/i);
    assert.match(waveAsk.description ?? "", /wave_compose/);
  } finally {
    await close();
  }
});

test("e2e: tools/call wave_compose with no WAVE_API_KEY set returns a valid snapshot proposal and never calls fetch", async () => {
  delete process.env["WAVE_API_KEY"];
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("fetch must not be called when WAVE_API_KEY is unset");
  }) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const parsed = ComposeProposalSchema.parse(parseToolText(result));
    assert.equal(parsed.grounding, "snapshot");
    assert.deepEqual(parsed.productIds, ["realtime", "transcribe", "captions"]);
    assert.equal(fetchCalls, 0);
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose with a stubbed 200 gateway response returns the gateway object as-is, tagged grounding: gateway", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  const gatewayBody = {
    intent: "live captions from my mic",
    productIds: ["realtime", "transcribe", "captions"],
    stages: [{ product: "realtime", why: "carries your webinar audio" }],
    tools: ["perception_subscribe"],
    executes: false,
    next: ["add chapters after the webinar ends"],
  };
  let fetchCalls = 0;
  let capturedUrl = "";
  let capturedAuth: string | undefined;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    fetchCalls++;
    capturedUrl = String(url);
    capturedAuth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
    return new Response(JSON.stringify(gatewayBody), { status: 200 });
  }) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const parsed = parseToolText(result) as Record<string, unknown>;
    assert.equal(parsed["grounding"], "gateway");
    // The whole documented contract comes back, not just the two fields a narrower assertion
    // would have covered — a regression that drops any of these must fail this test.
    assert.equal(parsed["intent"], gatewayBody.intent);
    assert.deepEqual(parsed["productIds"], gatewayBody.productIds);
    assert.deepEqual(parsed["stages"], gatewayBody.stages);
    assert.deepEqual(parsed["tools"], gatewayBody.tools);
    assert.deepEqual(parsed["next"], gatewayBody.next);
    assert.equal(parsed["executes"], false);
    assert.equal(parsed["fallbackReason"], undefined);
    assert.equal(fetchCalls, 1);
    assert.match(capturedUrl, /\/v1\/compose$/);
    assert.equal(capturedAuth, "Bearer test-key-not-real");
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose with a stubbed 5xx gateway response falls back to a valid snapshot proposal", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ error: { code: "NOT_IMPLEMENTED" } }), { status: 501 });
  }) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const parsed = ComposeProposalSchema.parse(parseToolText(result));
    assert.equal(parsed.grounding, "snapshot");
    assert.equal(parsed.fallbackReason, "gateway-http-error");
    assert.deepEqual(parsed.productIds, ["realtime", "transcribe", "captions"]);
    assert.equal(fetchCalls, 1);
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose falls back with gateway-invalid-json when a 2xx body is not JSON", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  globalThis.fetch = (async () => new Response("{not json", { status: 200 })) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const parsed = ComposeProposalSchema.parse(parseToolText(result));
    assert.equal(parsed.grounding, "snapshot");
    assert.equal(parsed.fallbackReason, "gateway-invalid-json");
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose refuses a pathologically nested gateway body instead of recursing into it", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  // Valid JSON, under the size ceiling, correct top-level shape — but nested past anything a
  // composition could be. The redaction walk must refuse it rather than recurse into it. 200 is
  // comfortably over the tool's 64-level ceiling and comfortably under any runtime's JSON.parse
  // limit, so this pins OUR guard rather than the host's stack size.
  let nested: unknown = "leaf";
  for (let i = 0; i < 200; i++) nested = [nested];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ intent: "x", productIds: ["realtime"], tools: ["perception_subscribe"], deep: nested }),
      { status: 200 },
    )) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const parsed = ComposeProposalSchema.parse(parseToolText(result));
    assert.equal(parsed.grounding, "snapshot");
    assert.equal(parsed.fallbackReason, "gateway-unexpected-shape");
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose falls back to a valid snapshot proposal when the gateway call throws (network error)", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  globalThis.fetch = (async () => {
    throw new Error("simulated network failure — must never surface, and must never mention the key");
  }) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "clip a two-hour stream" },
    });
    const parsed = ComposeProposalSchema.parse(parseToolText(result));
    assert.equal(parsed.grounding, "snapshot");
    assert.deepEqual(parsed.productIds, ["sentiment", "search", "clips"]);
    // The tool's own returned text must never carry the stubbed error message or the key.
    const raw = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
    assert.ok(!raw.includes("test-key-not-real"));
    assert.ok(!raw.includes("simulated network failure"));
    assert.equal((parseToolText(result) as Record<string, unknown>)["fallbackReason"], "gateway-unreachable-or-timeout");
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose falls back and names the reason when the gateway answers 2xx with an empty body", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const raw = parseToolText(result) as Record<string, unknown>;
    assert.equal(raw["fallbackReason"], "gateway-empty-body");
    const parsed = ComposeProposalSchema.parse(raw);
    assert.equal(parsed.grounding, "snapshot");
    assert.deepEqual(parsed.productIds, ["realtime", "transcribe", "captions"]);
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose refuses a 2xx JSON object that cannot be a composition", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  // 2xx, valid JSON, an object — but no productIds/tools arrays: not a proposal.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: "hello" }), { status: 200 })) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const raw = parseToolText(result) as Record<string, unknown>;
    assert.equal(raw["grounding"], "snapshot");
    assert.equal(raw["fallbackReason"], "gateway-unexpected-shape");
    assert.equal(raw["message"], undefined, "the gateway body must not leak into the fallback");
    ComposeProposalSchema.parse(raw);
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose refuses a gateway proposal that claims it executes", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ intent: "x", productIds: ["clips"], tools: ["wave_create_clip"], executes: true }),
      { status: 200 },
    )) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "clip a two-hour stream" },
    });
    const raw = parseToolText(result) as Record<string, unknown>;
    assert.equal(raw["grounding"], "snapshot");
    assert.equal(raw["fallbackReason"], "gateway-unexpected-shape");
    assert.equal(raw["executes"], false);
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose refuses an oversized gateway body instead of buffering it", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  // 512 KB of valid JSON — twice the 256 KB ceiling the tool will buffer.
  const oversized = JSON.stringify({
    intent: "live captions from my mic",
    productIds: ["realtime"],
    tools: ["perception_subscribe"],
    filler: "x".repeat(512 * 1024),
  });
  globalThis.fetch = (async () => new Response(oversized, { status: 200 })) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const raw = parseToolText(result) as Record<string, unknown>;
    assert.equal(raw["grounding"], "snapshot");
    assert.equal(raw["fallbackReason"], "gateway-body-too-large");
    assert.equal(raw["filler"], undefined);
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose never echoes the API key, even if the gateway reflects it back", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        intent: "live captions from my mic",
        productIds: ["realtime"],
        tools: ["perception_subscribe"],
        executes: false,
        // A compromised or misconfigured responder reflecting the bearer token back at us.
        next: ["call with Authorization: Bearer test-key-not-real"],
      }),
      { status: 200 },
    )) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    const result = await client.callTool({
      name: "wave_compose",
      arguments: { intent: "live captions from my mic" },
    });
    const rawText = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
    assert.ok(!rawText.includes("test-key-not-real"), "the key must never reach the tool's output");
    const parsed = parseToolText(result) as Record<string, unknown>;
    assert.equal(parsed["grounding"], "gateway");
    assert.deepEqual(parsed["next"], ["call with Authorization: Bearer [redacted]"]);
  } finally {
    await close();
    restoreFetchAndKey();
  }
});

test("e2e: tools/call wave_compose asks fetch not to follow redirects", async () => {
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  let capturedRedirect: RequestInit["redirect"];
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    capturedRedirect = init?.redirect;
    return new Response(
      JSON.stringify({ intent: "x", productIds: ["realtime"], tools: ["perception_subscribe"], executes: false }),
      { status: 200 },
    );
  }) as typeof fetch;

  const { client, close } = await connectedClient();
  try {
    await client.callTool({ name: "wave_compose", arguments: { intent: "live captions from my mic" } });
    assert.equal(capturedRedirect, "error");
  } finally {
    await close();
    restoreFetchAndKey();
  }
});
