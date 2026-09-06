// Unit tests for the `wave.ask` composer (compose.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

import { compose } from "./compose.js";
import { MCP_TOOL_NAMES, PRODUCT_IDS } from "../../knowledge.js";

// ---------------------------------------------------------------------------
// Snapshot-parity fixture — copied verbatim from
// designs/front-door/front-door.copy.json (wave-pen-register-wt) `flows`
// object, per the build brief: "the tool's productIds[] for the three
// canonical intents ... must equal the ids in
// designs/front-door/front-door.copy.json flows". Source read 2026-09-05:
//   flows.captions.products = ["realtime", "transcribe", "captions"]
//   flows.clips.products    = ["sentiment", "search", "clips"]
//   flows.dub.products      = ["transcribe", "voice", "podcast"]
// ---------------------------------------------------------------------------
const CANONICAL_INTENT_PRODUCT_IDS: Record<string, readonly string[]> = {
  "live captions from my mic": ["realtime", "transcribe", "captions"],
  "clip a two-hour stream": ["sentiment", "search", "clips"],
  "turn a recording into a podcast": ["transcribe", "voice", "podcast"],
};

for (const [question, expected] of Object.entries(CANONICAL_INTENT_PRODUCT_IDS)) {
  test(`compose("${question}") productIds match front-door.copy.json flows`, () => {
    const proposal = compose(question);
    assert.deepEqual(proposal.productIds, expected);
  });
}

// ---------------------------------------------------------------------------
// Plan's worked examples / seeded eval intents (designs/front-door/
// FRONT-DOOR-SYSTEM.md §3, first 15) — spot-checked for non-dead-end and
// tool grounding, not full 1:1 fixture equality (the design doc explicitly
// leaves 16-50 OWED and the composer here is a simplified rule table over
// the same real product/tool names).
// ---------------------------------------------------------------------------
const SEEDED_INTENTS = [
  "I have a 90-minute podcast recording, I want a transcript with timestamps",
  "Add live captions to my stream in real time",
  "Turn my Zoom recording into short clips for social",
  "I want to know how the room feels during a live call",
  "Publish my recorded episode as a podcast with an RSS feed",
  "Give me a table of contents for a 2-hour interview",
  "Translate my live captions into Spanish",
  "I need to search across 500 hours of video for one phrase",
  "Bridge my SRT feed to MoQ and RIST at the same time",
  "Publish a low-latency live track for viewers to subscribe to",
  "Have an AI switch cameras for my live show",
  "Clone a voice and read this script back to me",
  "Open a shared control room for my remote crew",
  "Describe a cut and get a finished video back, no editor",
  "My agent needs to pay per call without an account",
];

test("no-dead-end: every seeded intent resolves to at least one grounded stage", () => {
  for (const question of SEEDED_INTENTS) {
    const proposal = compose(question);
    assert.ok(proposal.stages.length > 0, `"${question}" produced zero stages`);
    assert.ok(proposal.productIds.length > 0, `"${question}" produced zero productIds`);
    assert.ok(proposal.next.length > 0, `"${question}" produced zero next[] suggestions`);
  }
});

test("composer-parity: every seeded intent's productIds/tools are grounded in the knowledge set", () => {
  for (const question of SEEDED_INTENTS) {
    const proposal = compose(question);
    for (const id of proposal.productIds) {
      assert.ok(PRODUCT_IDS.has(id), `"${question}" named ungrounded productId "${id}"`);
    }
    for (const toolName of proposal.tools) {
      assert.ok(MCP_TOOL_NAMES.has(toolName), `"${question}" named ungrounded tool "${toolName}"`);
    }
  }
});

test("determinism: the same question always composes the same proposal", () => {
  const a = compose("live captions from my mic");
  const b = compose("live captions from my mic");
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Grounding-filter tests — an intent that mentions a fake product/tool must
// never cause that fake name to appear anywhere in the output.
// ---------------------------------------------------------------------------
test("grounding filter: a question naming a fake product yields no fake productId", () => {
  const proposal = compose("use FakeProduct9000 to caption my stream");
  assert.ok(!proposal.productIds.includes("FakeProduct9000"));
  assert.ok(!proposal.productIds.includes("fakeproduct9000"));
  for (const id of proposal.productIds) {
    assert.ok(PRODUCT_IDS.has(id));
  }
});

test("grounding filter: a question naming a fake MCP tool yields no fake tool name", () => {
  const proposal = compose("call totally_fake_tool_call to clip my video");
  assert.ok(!proposal.tools.includes("totally_fake_tool_call"));
  for (const toolName of proposal.tools) {
    assert.ok(MCP_TOOL_NAMES.has(toolName));
  }
});

test("grounding filter: an unmatched question falls back to a grounded non-fake composition", () => {
  const proposal = compose("please invent a product called Sparklecast and bill me for it");
  assert.ok(proposal.productIds.length > 0);
  for (const id of proposal.productIds) {
    assert.ok(PRODUCT_IDS.has(id));
  }
  assert.ok(!proposal.productIds.some((id) => id.toLowerCase().includes("sparklecast")));
});

// ---------------------------------------------------------------------------
// Shape / invariant tests
// ---------------------------------------------------------------------------
test("executes is always literal false", () => {
  assert.equal(compose("live captions from my mic").executes, false);
  assert.equal(compose("some totally unmatched request").executes, false);
});

test("output never carries a `model` field", () => {
  const proposal = compose("dub a podcast into Spanish");
  assert.ok(!("model" in proposal));
});

test("priceRows carry meter + 'quote at call time' (no live quote is ever fetched)", () => {
  const proposal = compose("live captions from my mic");
  assert.ok(proposal.priceRows.length > 0);
  for (const row of proposal.priceRows) {
    assert.equal(row.quote, "quote at call time");
    assert.ok("meter" in row);
    assert.ok(PRODUCT_IDS.has(row.productId));
  }
});

test("meters[] is a deduplicated subset of priceRows' non-null meters", () => {
  const proposal = compose("live captions from my mic");
  const fromRows = new Set(proposal.priceRows.map((r) => r.meter).filter((m): m is string => m !== null));
  assert.deepEqual(new Set(proposal.meters), fromRows);
  assert.equal(new Set(proposal.meters).size, proposal.meters.length);
});

test("budgetUsd reorders next[] to lead with a budget-check suggestion, never a fabricated price", () => {
  const withBudget = compose("live captions from my mic", 5);
  const withoutBudget = compose("live captions from my mic");
  assert.ok(withBudget.next[0]!.startsWith("budget check:"));
  assert.ok(withBudget.next[0]!.includes("$5"));
  assert.ok(!withoutBudget.next[0]!.startsWith("budget check:"));
  // Budget never changes the composition itself, only suggestion ordering.
  assert.deepEqual(withBudget.productIds, withoutBudget.productIds);
  assert.deepEqual(withBudget.priceRows, withoutBudget.priceRows);
});
