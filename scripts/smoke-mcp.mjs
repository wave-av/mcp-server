#!/usr/bin/env node
// Fresh-install smoke driver for the stdio MCP server.
//
//   node scripts/smoke-mcp.mjs <path-to-installed-bin> [expectedToolCount] [toolName] [jsonArgs]
//
// Spawns the bin (argument array, no shell), performs the MCP handshake over
// newline-delimited JSON-RPC, lists tools, and optionally calls one tool. Exit 0
// when tools/list returns the expected count (or any non-empty list when no count
// is given) and, if a tool was named, the call returned a result or a gateway
// error that proves the request reached api.wave.online. Exit 1 otherwise.
// Environment is passed through untouched and never printed.
import { spawn } from "node:child_process";

const [bin, expectedRaw, toolName, jsonArgs] = process.argv.slice(2);
if (!bin) {
  console.error("usage: smoke-mcp.mjs <bin> [expectedToolCount] [toolName] [jsonArgs]");
  process.exit(2);
}
const expected = expectedRaw ? Number(expectedRaw) : undefined;
const TIMEOUT_MS = 30_000;

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
  console.log(`tools/list: ${tools.length} tools`);
  console.log(tools.map((t) => t.name).sort().join("\n"));
  if (tools.length === 0) {
    console.error("FAIL tools/list returned no tools");
    finish(1);
  }
  if (expected !== undefined && tools.length !== expected) {
    console.error(`FAIL expected ${expected} tools, got ${tools.length}`);
    finish(1);
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
