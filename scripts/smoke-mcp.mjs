#!/usr/bin/env node
// Fresh-install smoke driver for the stdio MCP server.
//
//   node scripts/smoke-mcp.mjs <path-to-installed-bin> [capabilities|expectedToolCount] [toolName] [jsonArgs]
//   node scripts/smoke-mcp.mjs <path-to-installed-bin> [capabilities|expectedToolCount] --all [--read-only]
//
// Spawns the bin (argument array, no shell), performs the MCP handshake over
// newline-delimited JSON-RPC, lists tools, and either calls one named tool or
// (with --all) calls every default-registered gateway-backed tool with safe
// arguments. --read-only limits --all to the GET tools, so nothing is billed.
// Environment is passed through untouched and never printed.
//
// OUTPUT NEVER CARRIES A RESPONSE BODY. Rows and diagnostics print the HTTP
// status, the gateway's error code when the body is its JSON error envelope,
// and a byte count — nothing else. A 2xx body from GET /v1/billing is the
// caller's organization id and plan; this script runs in a PUBLIC repo's CI
// logs.
//
// Since 0.4.0 every tools/call is also checked against the two 0.4.0 contracts:
//   - a non-2xx upstream answer comes back with `isError: true` (0.3.0 returned
//     "Error 404: ..." as a SUCCESSFUL tool result), and a 2xx never does;
//   - none of the tools 0.4.0 took out of the default registry (the
//     streams/productions/cameras/moderation routes api.wave.online does not
//     serve) is in tools/list unless WAVE_MCP_EXPERIMENTAL=1 is set, and all of
//     them are when it is. That set is read from capabilities.json
//     (exposes.optInMcpTools, group "unserved-backend"), which
//     scripts/check-capabilities-drift.ts gates against the registry — never
//     from a list copied into this file.
//
// The `capabilities` sentinel (preferred over a numeric literal) tells this
// script to derive the expected tool set from THIS repo's capabilities.json
// (exposes.mcpTools) rather than trust a count baked into the caller. That
// file is already gated against src/tools/index.ts by
// scripts/check-capabilities-drift.ts (CAP-001, run in lint.yml on every PR),
// so it cannot silently drift from what the server actually registers. A
// hardcoded number in a workflow YAML has no such gate: it goes stale the
// next time a tool is added and only surfaces as a red post-publish job (see
// the `expected 18 tools, got 24` failure on the v0.3.0 release — the count
// was bumped in smoke-install.yml but not in release.yml, and nothing forced
// the two to agree). Comparing the full NAME SET, not just the count, also
// catches the case a wrong tool count would miss: N tools present but the
// WRONG N (one registered tool swapped for a phantom one). Tools beyond the
// public set are accepted only when capabilities.json declares them opt-in
// AND their group's condition holds in this environment (see checkOptIns).
//
// A bare number is still accepted for callers that want a fixed count without
// reading capabilities.json (e.g. exercising an older published version whose
// capabilities.json doesn't match the checked-out repo's tool set).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classify } from "./smoke-classify.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const CAPABILITIES_PATH = join(REPO_ROOT, "capabilities.json");

const rawArgs = process.argv.slice(2);
const bin = rawArgs[0];
if (!bin) {
  console.error("usage: smoke-mcp.mjs <bin> [capabilities|expectedToolCount] [toolName] [jsonArgs]");
  console.error("       smoke-mcp.mjs <bin> [capabilities|expectedToolCount] --all [--read-only]");
  process.exit(2);
}
const allMode = rawArgs.includes("--all");
const readOnly = rawArgs.includes("--read-only");
const rest = rawArgs.slice(1).filter((a) => a !== "--all" && a !== "--read-only");
const expectedArg = rest[0];

const capabilities = JSON.parse(readFileSync(CAPABILITIES_PATH, "utf-8"));
const OPT_IN = capabilities.exposes?.optInMcpTools ?? [];
const UNSERVED_BY_DEFAULT = OPT_IN.filter((t) => t.group === "unserved-backend").map((t) => t.name);
if (UNSERVED_BY_DEFAULT.length === 0) {
  console.error(`FAIL capabilities.json at ${CAPABILITIES_PATH} declares no unserved-backend opt-in tools`);
  process.exit(2);
}

let expectedNames; // string[] | undefined — derived from capabilities.json
let expected; // number | undefined — a plain count, only when no name set is available
if (expectedArg === "capabilities") {
  expectedNames = (capabilities.exposes?.mcpTools ?? []).map((t) => t.name).sort();
  if (expectedNames.length === 0) {
    console.error(`FAIL capabilities.json at ${CAPABILITIES_PATH} declares no exposes.mcpTools`);
    process.exit(2);
  }
} else if (expectedArg !== undefined) {
  expected = Number(expectedArg);
}
const toolName = allMode ? undefined : rest[1];
const jsonArgs = allMode ? undefined : rest[2];
const TIMEOUT_MS = 30_000;

// A well-formed but non-existent UUID (v4-shaped nil-like marker), used where a
// tool needs a path/body ID but creating a real resource is not wanted.
const NIL_UUID = "00000000-0000-4000-8000-000000000001";
// A minimal, valid, silent WAV file (44-byte header, zero audio frames), base64.
const SILENT_WAV_B64 = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

const flag = (name) => {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
};
const experimental = flag("WAVE_MCP_EXPERIMENTAL");
// Presence only; the value is never read into output.
const internalSecretSet = (process.env["WAVE_INTERNAL_SECRET"] ?? "").length > 0;

const child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
const pending = new Map();
let nextId = 1;
let buf = "";

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch {
      console.error(`[non-json stdout] ${line.length} bytes`);
    }
  }
});
child.stderr.on("data", (chunk) => process.stderr.write(`[server stderr] ${chunk.toString().slice(0, 500)}`));
child.on("exit", (code, signal) => {
  if (pending.size > 0) {
    console.error(`FAIL server exited early code=${code} signal=${signal}`);
    process.exit(1);
  }
});

function rpc(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), TIMEOUT_MS).unref();
  });
}
function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function finish(code) {
  child.kill();
  process.exit(code);
}

// classify() and errorCodeOf() live in ./smoke-classify.mjs (pure, unit-tested by
// src/smoke-classify.test.ts); this file only drives the server and prints rows.

async function callTool(rows, name, route, args) {
  const call = await rpc("tools/call", { name, arguments: args });
  const c = classify(call);
  rows.push({ tool: name, route, status: c.status, marker: c.marker, pass: c.pass });
  console.log(`${name} | ${route} | ${c.status} | ${c.pass ? "PASS" : "FAIL"} | ${c.marker}`);
  return c;
}

/**
 * Opt-in tools in tools/list must match the environment exactly:
 *   - unserved-backend: every one of them when WAVE_MCP_EXPERIMENTAL=1, none otherwise;
 *   - internal-voice:   present exactly when WAVE_INTERNAL_SECRET is set;
 *   - design groups:    accepted when declared (their condition is a file check on the SERVER's
 *                       disk layout, which this script does not duplicate).
 * Returns the list of problems (empty when consistent).
 */
function checkOptIns(actualNames) {
  const problems = [];
  const present = (t) => actualNames.includes(t.name);
  for (const tool of OPT_IN) {
    const shouldBe =
      tool.group === "unserved-backend" ? experimental : tool.group === "internal-voice" ? internalSecretSet : undefined;
    if (shouldBe === true && !present(tool)) problems.push(`${tool.name} (${tool.group}) missing although its condition holds`);
    if (shouldBe === false && present(tool)) problems.push(`${tool.name} (${tool.group}) registered although its condition does not hold`);
  }
  return problems;
}

try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "wave-smoke-install", version: "0.0.0" },
  });
  const info = init.result?.serverInfo ?? {};
  console.log(`initialize: ${info.name} ${info.version} (protocol ${init.result?.protocolVersion})`);
  notify("notifications/initialized", {});

  const list = await rpc("tools/list", {});
  const tools = list.result?.tools ?? [];
  const actualNames = tools.map((t) => t.name).sort();
  console.log(`tools/list: ${tools.length} tools`);
  console.log(actualNames.join("\n"));
  if (tools.length === 0) {
    console.error("FAIL tools/list returned no tools");
    finish(1);
  }
  if (expectedNames !== undefined) {
    const declaredOptIn = new Set(OPT_IN.map((t) => t.name));
    const missing = expectedNames.filter((n) => !actualNames.includes(n));
    const extra = actualNames.filter((n) => !expectedNames.includes(n) && !declaredOptIn.has(n));
    if (missing.length > 0 || extra.length > 0) {
      console.error(
        `FAIL tools/list (${actualNames.length}) does not match capabilities.json's ` +
          `exposes.mcpTools (${expectedNames.length}) plus its declared opt-in tools`,
      );
      if (missing.length > 0) console.error(`  declared in capabilities.json but NOT served: ${missing.join(", ")}`);
      if (extra.length > 0) console.error(`  served but NOT declared in capabilities.json:  ${extra.join(", ")}`);
      finish(1);
    }
  } else if (expected !== undefined && tools.length !== expected) {
    console.error(`FAIL expected ${expected} tools, got ${tools.length}`);
    finish(1);
  }

  const optInProblems = checkOptIns(actualNames);
  if (optInProblems.length > 0) {
    console.error("FAIL opt-in tools in tools/list do not match this environment:");
    for (const p of optInProblems) console.error(`  ${p}`);
    finish(1);
  }

  if (allMode) {
    const rows = [];
    let missingTool = false;
    const wrap = async (name, route, args) => {
      if (!actualNames.includes(name)) {
        console.error(`FAIL --all expected ${name} in tools/list`);
        missingTool = true;
        return;
      }
      await callTool(rows, name, route, args);
    };

    // 1. Read-only tools (GET). Never billed.
    await wrap("wave_get_subscription", "GET /v1/billing", {});
    await wrap("wave_get_usage", "GET /v1/billing/usage", {});
    await wrap("wave_get_viewers", "GET /v1/analytics/engagement", {});

    // 2. Priced tools (POST). A 402 is a pass (the route is served and priced).
    //    Skipped with --read-only, so a local run bills nothing.
    if (!readOnly) {
      await wrap("wave_create_clip", "POST /v1/clips", { source: NIL_UUID, in: "0s", duration: "1s" });
      await wrap("wave_start_captions", "POST /v1/live/pipeline", {
        audio_base64: SILENT_WAV_B64,
        llm_model: "llama-3.1-8b-instant",
      });
    }

    const expectedRows = readOnly ? 3 : 5;
    const failed = rows.filter((r) => !r.pass);
    console.log("");
    console.log("=== smoke table ===");
    for (const r of rows) {
      console.log(`${r.tool} | ${r.route} | ${r.status} | ${r.pass ? "PASS" : "FAIL"}`);
    }
    if (rows.length !== expectedRows) {
      console.error(`FAIL --all called ${rows.length} tools, expected ${expectedRows}`);
      finish(1);
    }
    // The exit status is every row's verdict: a 401/403 (bad or under-scoped key) fails the run
    // exactly like a ROUTE_NOT_FOUND does.
    if (failed.length > 0) console.error(`FAIL ${failed.length} of ${rows.length} rows: ${failed.map((r) => r.tool).join(", ")}`);
    finish(missingTool || failed.length > 0 ? 1 : 0);
  }

  if (toolName) {
    const call = await rpc("tools/call", { name: toolName, arguments: jsonArgs ? JSON.parse(jsonArgs) : {} });
    const c = classify(call);
    console.log(`tools/call ${toolName} -> ${c.status} | ${c.marker}`);
    // A JSON-RPC error means the server itself failed. Otherwise the result must
    // be the gateway's own answer (a JSON document, or its JSON error envelope —
    // a 401/403 still proves the request reached the gateway, which is what this
    // single-call reachability probe asserts; --all is the stricter "works" gate).
    // An HTML document means the request fell through to a web page, which is the
    // regression this smoke exists to catch.
    if (call.error) {
      console.error("FAIL tools/call returned a JSON-RPC error");
      finish(1);
    }
    // The tool failed before any HTTP answer existed (e.g. WAVE_API_KEY unset): say so, rather than
    // the generic "does not show a gateway response" below.
    if (c.status === "none") {
      console.error(`FAIL tools/call ${toolName}: ${c.marker}`);
      finish(1);
    }
    if (c.marker.startsWith("isError=")) {
      console.error(`FAIL tools/call ${toolName}: ${c.marker}`);
      finish(1);
    }
    if (!c.reachedGateway) {
      console.error("FAIL tools/call result does not show a gateway response");
      finish(1);
    }
    if (/ROUTE_NOT_(FOUND|MAPPED)/.test(c.marker) || (c.status !== "2xx" && Number(c.status) >= 500)) {
      console.error(`FAIL tools/call ${toolName}: ${c.status} ${c.marker}`);
      finish(1);
    }
  }
  finish(0);
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  finish(1);
}
