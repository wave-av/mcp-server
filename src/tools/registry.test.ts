// The 0.4.0 registry contract (src/tools/index.ts): what a caller's tools/list contains is decided
// by the condition each tool can actually work under, not by the fact that the tool exists.
//
// Every test passes an explicit env object (never the ambient process.env), and points HOME at an
// empty temp dir, so a developer machine that happens to hold the internal design libraries under
// $HOME/wave-av/... gets the same answer as a customer machine and CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  EXPERIMENTAL_ENV_VAR,
  TOOL_GROUPS,
  UNSERVED_NOTE,
  allTools,
  experimentalEnabled,
  publicTools,
  registeredTools,
} from "./index.js";
import { isUnservedRoute } from "../knowledge.js";
import { LOC_STUDY_BIN, PEN_CONTRACT_FILES, PEN_EXTRACT_CLI } from "./design-lib.js";
import { EDGE_REFUSED_MESSAGE, resolveRealtimeEdge, voiceFailureMessage, voiceTools } from "./voice.js";

const EMPTY_HOME = mkdtempSync(join(tmpdir(), "wave-mcp-registry-home-"));
const names = (tools: readonly { name: string }[]): string[] => tools.map((t) => t.name).sort();

/** The route a tool's own description names: `(METHOD /v1/...)`. */
function routeOf(description: string): string | undefined {
  return /\((?:GET|POST|PUT|PATCH|DELETE) (\/v1\/[^\s,)]+)/.exec(description)?.[1];
}

const PUBLIC = [
  "wave.ask",
  "wave_compose",
  "wave_create_clip",
  "wave_get_subscription",
  "wave_get_usage",
  "wave_get_viewers",
  "wave_start_captions",
];

const UNSERVED = [
  "wave_control_camera",
  "wave_create_production",
  "wave_create_stream",
  "wave_get_stream_health",
  "wave_get_stream_metrics",
  "wave_list_productions",
  "wave_list_streams",
  "wave_mark_highlight",
  "wave_moderate_chat",
  "wave_show_graphic",
  "wave_start_stream",
  "wave_stop_stream",
  "wave_switch_camera",
];

test("registry: a customer with no opt-in gets exactly the 7 public tools", () => {
  assert.deepEqual(names(registeredTools({ HOME: EMPTY_HOME })), PUBLIC);
  assert.deepEqual(names(publicTools), PUBLIC);
});

test("registry: none of the 13 unserved-route tools is registered by default", () => {
  const registered = new Set(names(registeredTools({ HOME: EMPTY_HOME })));
  for (const name of UNSERVED) assert.ok(!registered.has(name), `${name} registered without opt-in`);
});

test(`registry: ${EXPERIMENTAL_ENV_VAR}=1 adds the 13 unserved-route tools, each description flagged`, () => {
  const tools = registeredTools({ HOME: EMPTY_HOME, [EXPERIMENTAL_ENV_VAR]: "1" });
  assert.deepEqual(names(tools), [...PUBLIC, ...UNSERVED].sort());
  for (const tool of tools.filter((t) => UNSERVED.includes(t.name))) {
    assert.ok(tool.description.startsWith(UNSERVED_NOTE), `${tool.name} description does not lead with the note`);
  }
});

test(`registry: ${EXPERIMENTAL_ENV_VAR} accepts 1/true (any case, padded) and nothing else`, () => {
  for (const on of ["1", "true", "TRUE", " True "]) assert.equal(experimentalEnabled({ [EXPERIMENTAL_ENV_VAR]: on }), true, on);
  for (const off of [undefined, "", "0", "false", "yes", "on"]) {
    assert.equal(experimentalEnabled({ [EXPERIMENTAL_ENV_VAR]: off }), false, String(off));
  }
});

test("registry: wave_voice_converse is registered only when WAVE_INTERNAL_SECRET is set", () => {
  assert.ok(!names(registeredTools({ HOME: EMPTY_HOME })).includes("wave_voice_converse"));
  assert.ok(!names(registeredTools({ HOME: EMPTY_HOME, WAVE_INTERNAL_SECRET: "" })).includes("wave_voice_converse"));
  assert.ok(names(registeredTools({ HOME: EMPTY_HOME, WAVE_INTERNAL_SECRET: "test-seal" })).includes("wave_voice_converse"));
});

/** Write `files` (relative paths) under `root` as tiny regular files. */
function touch(root: string, files: readonly string[]): void {
  for (const file of files) {
    const full = resolve(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "// fixture\n");
  }
}

/** A complete fake pen-extract checkout: <repo>/packages/pen-extract + <repo>/designs/contract. */
function fakePenExtract(files: readonly string[] = [PEN_EXTRACT_CLI, ...PEN_CONTRACT_FILES]): string {
  const root = join(mkdtempSync(join(tmpdir(), "wave-mcp-pen-register-")), "packages", "pen-extract");
  mkdirSync(root, { recursive: true });
  touch(root, files);
  return root;
}

/** A complete fake loc-study checkout: <root>/bin/loc-study.mjs. */
function fakeLocStudy(): string {
  const root = mkdtempSync(join(tmpdir(), "wave-mcp-loc-study-"));
  touch(root, [LOC_STUDY_BIN]);
  return root;
}

test("voice: the handler reads the secret at call time, and without it fails with isError naming the variable", async () => {
  const saved = process.env["WAVE_INTERNAL_SECRET"];
  delete process.env["WAVE_INTERNAL_SECRET"];
  try {
    const result = await voiceTools[0]!.handler({ room: "r1", audioPath: "/nonexistent.wav", outPath: "/nonexistent.pcm" });
    assert.equal(result.isError, true);
    assert.equal(result.content[0]!.text, "voice_converse failed: WAVE_INTERNAL_SECRET is not set on this MCP server");
  } finally {
    if (saved !== undefined) process.env["WAVE_INTERNAL_SECRET"] = saved;
  }
});

test("voice: WAVE_REALTIME_EDGE is held to a bare https origin (http only on loopback)", () => {
  assert.equal(resolveRealtimeEdge(undefined), "https://rt.wave.online");
  assert.equal(resolveRealtimeEdge("  "), "https://rt.wave.online");
  assert.equal(resolveRealtimeEdge("https://edge.example/"), "https://edge.example");
  assert.equal(resolveRealtimeEdge(" https://edge.example:8443 "), "https://edge.example:8443");
  assert.equal(resolveRealtimeEdge("http://localhost:8787"), "http://localhost:8787");
  assert.equal(resolveRealtimeEdge("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
  for (const bad of [
    "http://edge.example",
    "ftp://edge.example",
    "file:///etc/passwd",
    "edge.example",
    "https://edge.example/v1",
    "https://edge.example/?x=1",
    "https://edge.example/#f",
    "https://user:pw@edge.example/some/path",
  ]) {
    assert.throws(() => resolveRealtimeEdge(bad), (e: Error) => e.message === EDGE_REFUSED_MESSAGE, bad);
  }
});

test("voice: a refused edge fails with isError before any request, and never echoes the value or the secret", async () => {
  const saved = { secret: process.env["WAVE_INTERNAL_SECRET"], edge: process.env["WAVE_REALTIME_EDGE"] };
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    return new Response("{}");
  }) as typeof fetch;
  process.env["WAVE_INTERNAL_SECRET"] = "test-seal-not-a-credential";
  process.env["WAVE_REALTIME_EDGE"] = "http://user:pw@edge.example";
  try {
    const result = await voiceTools[0]!.handler({ room: "r1", audioPath: "/nonexistent.wav", outPath: "/nonexistent.pcm" });
    assert.equal(result.isError, true);
    assert.equal(result.content[0]!.text, `voice_converse failed: ${EDGE_REFUSED_MESSAGE}`);
    assert.ok(!result.content[0]!.text.includes("edge.example"), "echoed the configured edge");
    assert.ok(!result.content[0]!.text.includes("test-seal"), "echoed the secret");
    assert.equal(fetched, 0, "the bind was sent to a refused edge");
  } finally {
    globalThis.fetch = realFetch;
    for (const [name, value] of [["WAVE_INTERNAL_SECRET", saved.secret], ["WAVE_REALTIME_EDGE", saved.edge]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("voice: a failure that is not converse()'s own message is reduced to its class name", () => {
  assert.equal(voiceFailureMessage(new Error("bind failed: HTTP 502")), "bind failed: HTTP 502");
  assert.equal(voiceFailureMessage(new TypeError("fetch failed: https://edge/?token=abc")), "TypeError");
  assert.equal(voiceFailureMessage("a thrown string"), "unknown error");
});

test("registry: the design tools are registered only when their unpublished library is on disk and runnable", () => {
  const pen = fakePenExtract();
  const loc = fakeLocStudy();
  const design = ["wave_design_contract", "wave_design_contract_check", "wave_design_extract", "wave_design_measure"];

  const none = names(registeredTools({ HOME: EMPTY_HOME }));
  for (const name of design) assert.ok(!none.includes(name), `${name} registered with no library present`);

  const missing = names(registeredTools({ HOME: EMPTY_HOME, WAVE_PEN_EXTRACT_ROOT: join(pen, "does-not-exist") }));
  assert.ok(!missing.includes("wave_design_extract"), "a WAVE_PEN_EXTRACT_ROOT that does not exist registered tools");

  const withPen = names(registeredTools({ HOME: EMPTY_HOME, WAVE_PEN_EXTRACT_ROOT: pen }));
  assert.deepEqual(
    design.filter((n) => withPen.includes(n)),
    ["wave_design_contract", "wave_design_contract_check", "wave_design_extract"],
  );

  const withLoc = names(registeredTools({ HOME: EMPTY_HOME, WAVE_LOC_STUDY_ROOT: loc }));
  assert.deepEqual(design.filter((n) => withLoc.includes(n)), ["wave_design_measure"]);
});

test("registry: a library root that exists but cannot run registers nothing", () => {
  const design = new Set(["wave_design_contract", "wave_design_contract_check", "wave_design_extract", "wave_design_measure"]);
  const registersDesign = (env: NodeJS.ProcessEnv) => registeredTools({ HOME: EMPTY_HOME, ...env }).some((t) => design.has(t.name));

  // An empty directory.
  assert.equal(registersDesign({ WAVE_PEN_EXTRACT_ROOT: mkdtempSync(join(tmpdir(), "wave-mcp-pen-empty-")) }), false);
  assert.equal(registersDesign({ WAVE_LOC_STUDY_ROOT: mkdtempSync(join(tmpdir(), "wave-mcp-loc-empty-")) }), false);

  // A regular file where the root directory should be.
  const fileRoot = join(mkdtempSync(join(tmpdir(), "wave-mcp-file-root-")), "not-a-dir");
  writeFileSync(fileRoot, "x");
  assert.equal(registersDesign({ WAVE_PEN_EXTRACT_ROOT: fileRoot }), false);
  assert.equal(registersDesign({ WAVE_LOC_STUDY_ROOT: fileRoot }), false);

  // An entrypoint that is a directory, not a file.
  const dirEntry = mkdtempSync(join(tmpdir(), "wave-mcp-loc-dir-entry-"));
  mkdirSync(join(dirEntry, LOC_STUDY_BIN), { recursive: true });
  assert.equal(registersDesign({ WAVE_LOC_STUDY_ROOT: dirEntry }), false);
  const cliDir = mkdtempSync(join(tmpdir(), "wave-mcp-pen-dir-entry-"));
  mkdirSync(join(cliDir, PEN_EXTRACT_CLI), { recursive: true });
  assert.equal(registersDesign({ WAVE_PEN_EXTRACT_ROOT: cliDir }), false);
});

test("registry: each pen-extract tool is registered by exactly the files it runs (PR #145 review round 2)", () => {
  const pen = ["wave_design_contract", "wave_design_contract_check", "wave_design_extract"];
  const penTools = (root: string) =>
    names(registeredTools({ HOME: EMPTY_HOME, WAVE_PEN_EXTRACT_ROOT: root })).filter((n) => pen.includes(n));

  // The CLI alone runs wave_design_extract; the contract tools need files it does not have.
  assert.deepEqual(penTools(fakePenExtract([PEN_EXTRACT_CLI])), ["wave_design_extract"]);
  // The contract files alone run wave_design_contract_check; extract and contract need the CLI.
  assert.deepEqual(penTools(fakePenExtract(PEN_CONTRACT_FILES)), ["wave_design_contract_check"]);
  // wave_design_contract composes with the CLI and then validates, so it needs every file.
  for (const missing of PEN_CONTRACT_FILES) {
    const partial = fakePenExtract([PEN_EXTRACT_CLI, ...PEN_CONTRACT_FILES.filter((f) => f !== missing)]);
    assert.deepEqual(penTools(partial), ["wave_design_extract"], `registered contract tools without ${missing}`);
  }
  assert.deepEqual(penTools(fakePenExtract()), pen);
});

test("registry: every opt-in group enabled at once registers the whole 25-tool catalogue", () => {
  const all = registeredTools({
    HOME: EMPTY_HOME,
    [EXPERIMENTAL_ENV_VAR]: "1",
    WAVE_INTERNAL_SECRET: "test-seal",
    WAVE_PEN_EXTRACT_ROOT: fakePenExtract(),
    WAVE_LOC_STUDY_ROOT: fakeLocStudy(),
  });
  assert.equal(all.length, 25);
  assert.deepEqual(names(all), names(allTools));
  assert.equal(new Set(names(allTools)).size, allTools.length, "duplicate tool name in the catalogue");
});

test("registry: each tool sits in exactly one group", () => {
  const seen = new Map<string, string>();
  for (const group of TOOL_GROUPS) {
    for (const tool of group.tools) {
      assert.ok(!seen.has(tool.name), `${tool.name} is in both ${seen.get(tool.name)} and ${group.id}`);
      seen.set(tool.name, group.id);
    }
  }
});

test("registry: no public tool calls a route in a family the gateway lists as unserved", () => {
  for (const tool of publicTools) {
    const route = routeOf(tool.description);
    if (route === undefined) continue; // wave.ask is offline; wave_compose names its route in prose
    assert.ok(!isUnservedRoute(route), `public tool ${tool.name} calls unserved route ${route}`);
  }
});

test("registry: every unserved-backend tool calls an unserved family, or POST /v1/moderate", () => {
  const group = TOOL_GROUPS.find((g) => g.id === "unserved-backend");
  assert.ok(group);
  for (const tool of group!.tools) {
    const route = routeOf(tool.description);
    assert.ok(route, `${tool.name} description names no /v1 route`);
    assert.ok(
      isUnservedRoute(route!) || route === "/v1/moderate",
      `${tool.name} calls ${route}, which is not an unserved family — it may belong in the public group`,
    );
  }
});

test("wave_start_captions: stream_id accepts only the charset its description promises", async () => {
  const { z } = await import("zod");
  const captions = publicTools.find((t) => t.name === "wave_start_captions");
  assert.ok(captions);
  const schema = z.object(captions!.inputSchema);
  const base = {
    audio_base64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
    llm_model: "llama-3.1-8b-instant",
  };
  for (const ok of ["s1", "room.42:mic-A_b", "x".repeat(128)]) {
    assert.equal(schema.safeParse({ ...base, stream_id: ok }).success, true, ok);
  }
  assert.equal(schema.safeParse(base).success, true, "stream_id stays optional");
  for (const bad of ["", "x".repeat(129), "a b", "a/b", "a\nb", "https://evil.example/", "é"]) {
    assert.equal(schema.safeParse({ ...base, stream_id: bad }).success, false, JSON.stringify(bad));
  }
});
