// Tests for the `wave.ask` WaveToolDef itself: the zod input schema and the
// handler's text-content output. See compose.test.ts for composer-logic
// coverage and ../../wave-ask.e2e.test.ts for the in-process MCP transport test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { waveAskTools } from "./wave-ask.js";
import { compose } from "./compose.js";

const waveAsk = waveAskTools[0]!;

test("wave.ask is registered under the exact tool name from the plan", () => {
  assert.equal(waveAsk.name, "wave.ask");
});

test("wave.ask description states the propose-never-executes contract", () => {
  assert.match(waveAsk.description, /never execute/i);
});

const InputSchema = z.object(waveAsk.inputSchema);

test("input schema accepts {question}", () => {
  const parsed = InputSchema.parse({ question: "live captions from my mic" });
  assert.equal(parsed.question, "live captions from my mic");
  assert.equal(parsed.budgetUsd, undefined);
});

test("input schema accepts {question, budgetUsd}", () => {
  const parsed = InputSchema.parse({ question: "clip a two-hour stream", budgetUsd: 10 });
  assert.equal(parsed.budgetUsd, 10);
});

test("input schema rejects a missing question", () => {
  assert.throws(() => InputSchema.parse({}));
});

test("input schema rejects an empty question", () => {
  assert.throws(() => InputSchema.parse({ question: "" }));
});

test("input schema rejects a question over 500 characters", () => {
  assert.throws(() => InputSchema.parse({ question: "a".repeat(501) }));
});

test("input schema rejects a negative budgetUsd", () => {
  assert.throws(() => InputSchema.parse({ question: "clip a stream", budgetUsd: -1 }));
});

test("input schema rejects a non-finite budgetUsd", () => {
  assert.throws(() => InputSchema.parse({ question: "clip a stream", budgetUsd: Infinity }));
});

test("handler returns a single text content block that JSON-parses to the compose() output", async () => {
  const result = await waveAsk.handler({ question: "live captions from my mic" });
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]!.type, "text");
  const parsed: unknown = JSON.parse(result.content[0]!.text);
  assert.deepEqual(parsed, compose("live captions from my mic"));
});

test("handler threads budgetUsd through to compose()", async () => {
  const result = await waveAsk.handler({ question: "clip a two-hour stream", budgetUsd: 5 });
  const parsed: unknown = JSON.parse(result.content[0]!.text);
  assert.deepEqual(parsed, compose("clip a two-hour stream", 5));
});

test("handler never touches the network — no fetch spy is needed because compose() is pure, " +
  "but confirm the result contains no callShape/URL artifact that would imply one", async () => {
  const result = await waveAsk.handler({ question: "dub a podcast into Spanish" });
  const parsed = JSON.parse(result.content[0]!.text) as { executes: boolean; model?: unknown };
  assert.equal(parsed.executes, false);
  assert.equal("model" in parsed, false);
});
