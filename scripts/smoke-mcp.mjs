#!/usr/bin/env node
// Fresh-install smoke driver for the stdio MCP server.
//
//   node scripts/smoke-mcp.mjs <path-to-installed-bin> [capabilities|expectedToolCount] [toolName] [jsonArgs]
//   node scripts/smoke-mcp.mjs <path-to-installed-bin> [capabilities|expectedToolCount] --all
//
// Spawns the bin (argument array, no shell), performs the MCP handshake over
// newline-delimited JSON-RPC, lists tools, and either calls one named tool or
// (with --all) calls every registered tool with safe arguments. Environment is
// passed through untouched and never printed.
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
// WRONG N (one registered tool swapped for a phantom one).
//
// A bare number is still accepted for callers that want a fixed count without
// reading capabilities.json (e.g. exercising an older published version whose
// capabilities.json doesn't match the checked-out repo's tool set).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

const rawArgs = process.argv.slice(2);
const bin = rawArgs[0];
if (!bin) {
  console.error("usage: smoke-mcp.mjs <bin> [capabilities|expectedToolCount] [toolName] [jsonArgs]");
  console.error("       smoke-mcp.mjs <bin> [capabilities|expectedToolCount] --all");
  process.exit(2);
}
const allMode = rawArgs.includes("--all");
const rest = rawArgs.slice(1).filter((a) => a !== "--all");
const expectedArg = rest[0];
let expectedNames; // string[] | undefined — derived from capabilities.json
let expected; // number | undefined — a plain count, only when no name set is available
if (expectedArg === "capabilities") {
  const capabilitiesPath = join(REPO_ROOT, "capabilities.json");
  const capabilities = JSON.parse(readFileSync(capabilitiesPath, "utf-8"));
  expectedNames = (capabilities.exposes?.mcpTools ?? []).map((t) => t.name).sort();
  if (expectedNames.length === 0) {
    console.error(`FAIL capabilities.json at ${capabilitiesPath} declares no exposes.mcpTools`);
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
      console.error("[non-json stdout]", line.slice(0, 200));
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

/**
 * Extract a resource id from a tool's passthrough JSON body, trying the
 * shapes real WAVE responses commonly use. Returns undefined if none found.
 */
function extractId(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    return parsed?.id ?? parsed?.stream?.id ?? parsed?.production?.id ?? parsed?.data?.id ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classify a tools/call result into a smoke-table row.
 * Tool handlers return either the raw passthrough JSON (success) or the
 * "Error <status>: <body>" text errorContent() produces (non-2xx).
 */
function classify(call) {
  if (call.error) {
    return { status: "ERR", marker: "jsonrpc-error", pass: false, hardFail: true, body: JSON.stringify(call.error) };
  }
  const text = call.result?.content?.[0]?.text ?? "";
  const m = /^Error (\d+): ([\s\S]*)$/.exec(text);
  const status = m ? m[1] : "2xx";
  const body = m ? m[2] : text;
  const isHtml = /<!DOCTYPE|<html/i.test(body);
  const routeNotMapped = /ROUTE_NOT_MAPPED/i.test(body);
  const numStatus = m ? Number(m[1]) : 200;
  const hardFail = isHtml || routeNotMapped || numStatus === 404 || numStatus >= 500;
  const pass = !hardFail && (status === "2xx" || numStatus === 402);
  const marker = isHtml ? "HTML" : routeNotMapped ? "ROUTE_NOT_MAPPED" : body.slice(0, 80).replace(/\s+/g, " ");
  return { status, marker, pass, hardFail, body };
}

async function callTool(rows, name, route, args) {
  const call = await rpc("tools/call", { name, arguments: args });
  const c = classify(call);
  rows.push({ tool: name, route, status: c.status, marker: c.marker, pass: c.pass });
  console.log(`${name} | ${route} | ${c.status} | ${c.pass ? "PASS" : "FAIL"} | ${c.marker}`);
  return c;
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
    const missing = expectedNames.filter((n) => !actualNames.includes(n));
    const extra = actualNames.filter((n) => !expectedNames.includes(n));
    if (missing.length > 0 || extra.length > 0) {
      console.error(
        `FAIL tools/list (${actualNames.length}) does not match capabilities.json's ` +
          `exposes.mcpTools (${expectedNames.length})`,
      );
      if (missing.length > 0) console.error(`  declared in capabilities.json but NOT served: ${missing.join(", ")}`);
      if (extra.length > 0) console.error(`  served but NOT declared in capabilities.json:  ${extra.join(", ")}`);
      finish(1);
    }
  } else if (expected !== undefined && tools.length !== expected) {
    console.error(`FAIL expected ${expected} tools, got ${tools.length}`);
    finish(1);
  }

  if (allMode) {
    const rows = [];
    let hardFail = false;
    const wrap = async (name, route, args) => {
      const c = await callTool(rows, name, route, args);
      if (c.hardFail) hardFail = true;
    };

    const iso = new Date().toISOString();

    // 1. Read-only / list tools first.
    await wrap("wave_list_streams", "GET /v1/streams", {});
    await wrap("wave_list_productions", "GET /v1/productions", {});
    await wrap("wave_get_subscription", "GET /v1/billing", {});
    await wrap("wave_get_usage", "GET /v1/billing/usage", {});
    await wrap("wave_get_viewers", "GET /v1/analytics/engagement", {});

    // 2. Create a stream, then exercise its lifecycle.
    const createStream = await callTool(rows, "wave_create_stream", "POST /v1/streams", {
      title: `mcp-smoke-${iso}`,
    });
    const streamId = extractId(createStream.body) ?? NIL_UUID;

    await wrap("wave_start_stream", "POST /v1/streams/{id}/start", { stream_id: streamId });
    await wrap("wave_get_stream_health", "GET /v1/streams/{id}/status", { stream_id: streamId });
    await wrap("wave_get_stream_metrics", "GET /v1/streams/{id}/analytics", { stream_id: streamId });
    await wrap("wave_mark_highlight", "POST /v1/streams/{id}/highlights", { stream_id: streamId, label: "smoke" });
    await wrap("wave_stop_stream", "POST /v1/streams/{id}/stop", { stream_id: streamId });
    await wrap("wave_moderate_chat", "POST /v1/moderate", {
      stream_id: streamId,
      message_id: "smoke-msg-1",
      action: "flag",
    });

    // 3. Create a production, then exercise its controls.
    const createProduction = await callTool(rows, "wave_create_production", "POST /v1/productions", {
      title: `mcp-smoke-${iso}`,
    });
    const productionId = extractId(createProduction.body) ?? NIL_UUID;

    await wrap("wave_switch_camera", "POST /v1/productions/{id}/camera", {
      production_id: productionId,
      camera_index: 0,
      bus: "program",
    });
    await wrap("wave_show_graphic", "POST /v1/productions/{id}/overlay", {
      production_id: productionId,
      overlay_id: "smoke",
      visible: true,
    });

    // 4. Nil-uuid / independent operations — nothing destructive beyond this point.
    await wrap("wave_control_camera", "POST /v1/cameras/{id}/control", {
      camera_id: NIL_UUID,
      command: "autofocus_trigger",
    });
    await wrap("wave_create_clip", "POST /v1/clips", { source: NIL_UUID, in: "0s", duration: "1s" });
    await wrap("wave_start_captions", "POST /v1/live/pipeline", {
      audio_base64: SILENT_WAV_B64,
      llm_model: "llama-3.1-8b-instant",
    });

    console.log("");
    console.log("=== smoke table ===");
    for (const r of rows) {
      console.log(`${r.tool} | ${r.route} | ${r.status} | ${r.pass ? "PASS" : "FAIL"}`);
    }
    if (rows.length !== 18) {
      console.error(`FAIL --all called ${rows.length} tools, expected 18`);
      finish(1);
    }
    finish(hardFail ? 1 : 0);
  }

  if (toolName) {
    const call = await rpc("tools/call", { name: toolName, arguments: jsonArgs ? JSON.parse(jsonArgs) : {} });
    const body = JSON.stringify(call.result ?? call.error ?? {});
    console.log(`tools/call ${toolName} -> ${body.slice(0, 600)}`);
    // A JSON-RPC error means the server itself failed. The tool result must be
    // the gateway's own answer: a JSON payload, or one of its JSON error
    // contracts (401/402/403 with a code or problem type). An HTML document means
    // the request fell through to a web page, which is the regression this
    // smoke exists to catch.
    if (call.error) {
      console.error("FAIL tools/call returned a JSON-RPC error");
      finish(1);
    }
    if (/<!DOCTYPE|<html/i.test(body)) {
      console.error("FAIL tools/call received an HTML page, not a gateway response");
      finish(1);
    }
    const reached = /SCOPE_INSUFFICIENT|PAYMENT_REQUIRED|ROUTE_NOT_MAPPED|errors\/unauthorized|\\"status\\":\s*(2\d\d|401|402|403)|\\"data\\"|\\"streams\\"/i.test(body);
    if (!reached) {
      console.error("FAIL tools/call result does not show a gateway response");
      finish(1);
    }
  }
  finish(0);
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  finish(1);
}
