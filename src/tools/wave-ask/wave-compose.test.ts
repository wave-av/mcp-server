// wave_compose holds a LIVE gateway proposal to the same contract as a snapshot one (PR #145
// review): no tool whose route the gateway lists as unserved, and `toolsServer` always the
// allowlisted hosted WAVE MCP endpoint — never a value the responder supplied.
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeLiveProposal, waveComposeTools } from "./wave-compose.js";
import { HOSTED_MCP_URL, UNSERVED_MCP_TOOL_NAMES, isTrustedHostedMcpUrl } from "../../knowledge.js";

const UNSERVED = [...UNSERVED_MCP_TOOL_NAMES].sort()[0]!;

test("normalizeLiveProposal: drops unserved and non-string tools, keeps served and newer-than-snapshot names", () => {
  assert.ok(UNSERVED, "the snapshot lists at least one unserved hosted tool");
  const out = normalizeLiveProposal({
    productIds: ["captions"],
    tools: ["perception_subscribe", UNSERVED, 42, null, { name: "x" }, "a_tool_newer_than_the_snapshot"],
    executes: false,
  });
  assert.deepEqual(out["tools"], ["perception_subscribe", "a_tool_newer_than_the_snapshot"]);
  assert.deepEqual(out["productIds"], ["captions"], "fields it does not own are untouched");
});

test("normalizeLiveProposal: toolsServer is always the hosted MCP URL, even when the responder names another", () => {
  assert.equal(normalizeLiveProposal({ productIds: [], tools: [] })["toolsServer"], HOSTED_MCP_URL);
  const hostile = normalizeLiveProposal({ productIds: [], tools: [], toolsServer: "https://evil.example/mcp" });
  assert.equal(hostile["toolsServer"], HOSTED_MCP_URL);
});

test("wave_compose: a live 200 proposal naming an unserved tool reaches the agent without it", async () => {
  const savedFetch = globalThis.fetch;
  const savedKey = process.env["WAVE_API_KEY"];
  process.env["WAVE_API_KEY"] = "test-key-not-real";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        intent: "x",
        productIds: ["realtime"],
        tools: [UNSERVED, "perception_subscribe"],
        executes: false,
        toolsServer: "https://evil.example/mcp",
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    const result = await waveComposeTools[0]!.handler({ intent: "live captions from my mic" });
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    assert.equal(parsed["grounding"], "gateway");
    assert.deepEqual(parsed["tools"], ["perception_subscribe"]);
    assert.equal(parsed["toolsServer"], HOSTED_MCP_URL);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env["WAVE_API_KEY"];
    else process.env["WAVE_API_KEY"] = savedKey;
  }
});

test("isTrustedHostedMcpUrl: only https WAVE hosts at exactly /mcp", () => {
  assert.equal(isTrustedHostedMcpUrl(HOSTED_MCP_URL), true, "the bundled snapshot's own URL passes");
  for (const ok of ["https://api.wave.online/mcp", "https://mcp.wave.online/mcp"]) {
    assert.equal(isTrustedHostedMcpUrl(ok), true, ok);
  }
  for (const bad of [
    "",
    "not a url",
    "http://api.wave.online/mcp",
    "https://evil.example/mcp",
    "https://api.wave.online.evil.example/mcp",
    "https://api.wave.online/mcp/",
    "https://api.wave.online/other/mcp",
    "https://api.wave.online:8443/mcp",
    "https://user:pass@api.wave.online/mcp",
    "https://api.wave.online/mcp?x=1",
    "https://api.wave.online/mcp#frag",
  ]) {
    assert.equal(isTrustedHostedMcpUrl(bad), false, bad);
  }
});
