// The live smoke's row classification (scripts/smoke-classify.mjs), and the smoke script itself run
// end to end against the REAL stdio entry point with no key.
//
// The smoke is what proves a release live (smoke-install.yml, release.yml, and by hand when Actions
// cannot run), so a row must say what actually happened. Through the first 0.4.0 drafts a tool that
// failed locally (WAVE_API_KEY unset) was printed as "2xx | FAIL | isError=true on a 2xx result":
// the table claimed GET /v1/billing had answered 2xx when no request had been sent.
//
// Nothing here touches the network: the unit cases are pure, and the end-to-end run has no
// WAVE_API_KEY, so every tool refuses before it builds a request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface Row {
  status: string;
  marker: string;
  pass: boolean;
  reachedGateway: boolean;
}
interface ClassifyModule {
  classify: (call: unknown) => Row;
  errorCodeOf: (json: unknown) => string | undefined;
}

// Compiled to .ts-out/smoke-classify.test.js: this directory holds the compiled stdio entry
// (index.js), and its parent is the repo root (scripts/, capabilities.json).
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SERVER_ENTRY = join(HERE, "index.js");
const SMOKE = join(ROOT, "scripts", "smoke-mcp.mjs");

const { classify, errorCodeOf } = (await import(
  pathToFileURL(join(ROOT, "scripts", "smoke-classify.mjs")).href
)) as ClassifyModule;

const ORG_ID = "00000000-0000-4000-8000-0000000000aa";
const MISSING_KEY_TEXT =
  "WAVE_API_KEY environment variable is required. Set it to your WAVE API key before starting the MCP " +
  "server. You can generate one at https://console.wave.online/dashboard#keys";

function toolResult(text: string, isError?: boolean): unknown {
  return { result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) } };
}
function httpError(status: number, code: string): unknown {
  return toolResult(`Error ${status}: ${JSON.stringify({ error: { code, message: "m" } })}`, true);
}

test("smoke classify: a 2xx JSON document passes, and its body never reaches the marker", () => {
  const row = classify(toolResult(JSON.stringify({ organizationId: ORG_ID, plan: "free" })));
  assert.equal(row.status, "2xx");
  assert.equal(row.pass, true);
  assert.equal(row.reachedGateway, true);
  assert.match(row.marker, /^json \(\d+ bytes\)$/);
  assert.doesNotMatch(row.marker, new RegExp(ORG_ID));
});

test("smoke classify: a 402 is served and priced (pass); 401, 403, 429, ROUTE_NOT_FOUND and 5xx fail", () => {
  const x402 = classify(toolResult(`Error 402: ${JSON.stringify({ x402Version: 1, accepts: [] })}`, true));
  assert.equal(x402.pass, true);
  assert.match(x402.marker, /^x402 /);

  for (const [status, code] of [
    [401, "AUTH_REQUIRED"],
    [403, "SCOPE_INSUFFICIENT"],
    [429, "RATE_LIMITED"],
    [404, "ROUTE_NOT_FOUND"],
    [404, "ROUTE_NOT_MAPPED"],
    [502, "UPSTREAM_ERROR"],
  ] as const) {
    const row = classify(httpError(status, code));
    assert.equal(row.status, String(status));
    assert.equal(row.pass, false, `${status} ${code} must fail`);
    assert.equal(row.reachedGateway, true);
    assert.match(row.marker, new RegExp(`^${code} \\(\\d+ bytes\\)$`));
  }
});

test("smoke classify: a 4xx validation answer from a served route passes", () => {
  const row = classify(httpError(404, "NOT_FOUND"));
  assert.equal(row.pass, true);
});

test("smoke classify: a non-2xx without isError is the 0.3.0 bug and fails", () => {
  const row = classify(toolResult(`Error 404: ${JSON.stringify({ error: { code: "ROUTE_NOT_FOUND" } })}`));
  assert.equal(row.pass, false);
  assert.equal(row.marker, "isError=false on a 404 result");
});

test("smoke classify: a local failure has no HTTP status — never reported as a 2xx", () => {
  const missingKey = classify(toolResult(MISSING_KEY_TEXT, true));
  assert.deepEqual(missingKey, {
    status: "none",
    marker: "local failure, no HTTP answer (WAVE_API_KEY is not set)",
    pass: false,
    reachedGateway: false,
  });

  // Any other local failure text is counted, never printed.
  const other = classify(toolResult("voice_converse failed: bind answered FRAGMENT_SHOULD_NOT_PRINT", true));
  assert.equal(other.status, "none");
  assert.equal(other.pass, false);
  assert.match(other.marker, /^local failure, no HTTP answer \(\d+ bytes\)$/);
  assert.doesNotMatch(other.marker, /SHOULD_NOT_PRINT/);
});

test("smoke classify: a JSON-RPC error and an HTML page both fail", () => {
  const rpc = classify({ error: { code: -32602, message: "bad params" } });
  assert.deepEqual(rpc, { status: "ERR", marker: "jsonrpc-error -32602", pass: false, reachedGateway: false });

  const html = classify(toolResult("<!DOCTYPE html><html><body>marketing</body></html>"));
  assert.equal(html.pass, false);
  assert.equal(html.marker, "HTML page");
});

test("smoke classify: errorCodeOf reads only identifier-shaped codes", () => {
  assert.equal(errorCodeOf({ error: { code: "ROUTE_NOT_FOUND" } }), "ROUTE_NOT_FOUND");
  assert.equal(errorCodeOf({ type: "https://wave.online/problems/bad-request" }), "https://wave.online/problems/bad-request");
  assert.equal(errorCodeOf({ x402Version: 1 }), "x402");
  assert.equal(errorCodeOf({ error: { code: "has spaces and a secret" } }), undefined);
  assert.equal(errorCodeOf(null), undefined);
});

function runSmoke(args: readonly string[]): { status: number | null; out: string } {
  const home = mkdtempSync(join(tmpdir(), "wave-mcp-smoke-home-"));
  try {
    // Only PATH and an empty HOME: no WAVE_API_KEY, no internal secret, no sibling design library.
    const res = spawnSync(process.execPath, [SMOKE, SERVER_ENTRY, ...args], {
      env: { PATH: process.env["PATH"] ?? "", HOME: home },
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("smoke end to end, no key, --all --read-only: every row is a local failure and the run fails", () => {
  const { status, out } = runSmoke(["capabilities", "--all", "--read-only"]);
  assert.equal(status, 1, out);
  for (const [tool, route] of [
    ["wave_get_subscription", "GET /v1/billing"],
    ["wave_get_usage", "GET /v1/billing/usage"],
    ["wave_get_viewers", "GET /v1/analytics/engagement"],
  ]) {
    assert.ok(
      out.includes(`${tool} | ${route} | none | FAIL | local failure, no HTTP answer (WAVE_API_KEY is not set)`),
      `${tool} row:\n${out}`,
    );
  }
  assert.doesNotMatch(out, /\| 2xx \|/);
  assert.match(out, /FAIL 3 of 3 rows/);
});

test("smoke end to end, no key, one tool: the failure names the missing key", () => {
  const { status, out } = runSmoke(["capabilities", "wave_get_subscription"]);
  assert.equal(status, 1, out);
  assert.match(out, /tools\/call wave_get_subscription -> none \| local failure, no HTTP answer \(WAVE_API_KEY is not set\)/);
  assert.match(out, /FAIL tools\/call wave_get_subscription: local failure, no HTTP answer \(WAVE_API_KEY is not set\)/);
});
