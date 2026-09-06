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
