// The 0.4.0 wire contract, over BOTH transports this package ships:
//   - stdio:  buildServer() — the exact McpServer src/server.ts connects to StdioServerTransport;
//   - in-process Agent SDK: createWaveSdkMcpServer() — src/sdk-server.ts.
// A real MCP Client is connected to each over an in-memory transport pair; `fetch` is replaced with a
// recorder, so nothing leaves the process. What is proven:
//   1. a non-2xx WAVE API answer is a FAILED tool call (`isError: true`) on both transports, and a 2xx
//      is not (0.3.0 returned "Error 404: ..." as a successful result);
//   2. a default tools/list carries no tool whose route api.wave.online does not serve;
//   3. wave://streams/{id} and wave://productions/{id} are real resource TEMPLATES when opted in
//      (0.3.0 registered a fixed resource whose URI literally contained "{id}"), and absent otherwise.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "./server.js";
import { createWaveSdkMcpServer } from "./sdk-server.js";
import { PKG_VERSION } from "./version.js";

const EMPTY_HOME = mkdtempSync(join(tmpdir(), "wave-mcp-transports-home-"));
const DUMMY_KEY = "wave_live_test_dummy_not_a_credential";
const ROUTE_NOT_FOUND = JSON.stringify({
  error: { code: "ROUTE_NOT_FOUND", message: "No WAVE capability is served at this path." },
});
const BILLING_OK = JSON.stringify({ organizationId: "00000000-0000-4000-8000-000000000001", plan: "free", subscription: null });

interface Recorded {
  url: string;
  method: string;
  authorization: string | null;
  redirect: RequestInit["redirect"];
}

let calls: Recorded[] = [];
let nextResponse: { status: number; body: string; contentType?: string } = { status: 200, body: "{}" };
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

beforeEach(() => {
  calls = [];
  process.env["WAVE_API_KEY"] = DUMMY_KEY;
  process.env["HOME"] = EMPTY_HOME;
  delete process.env["WAVE_BASE_URL"];
  delete process.env["WAVE_MCP_EXPERIMENTAL"];
  delete process.env["WAVE_INTERNAL_SECRET"];
  delete process.env["WAVE_REALTIME_EDGE"];
  delete process.env["WAVE_PEN_EXTRACT_ROOT"];
  delete process.env["WAVE_LOC_STUDY_ROOT"];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", authorization: headers.get("authorization"), redirect: init?.redirect });
    return new Response(nextResponse.body, {
      status: nextResponse.status,
      headers: { "content-type": nextResponse.contentType ?? "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

type Connectable = { connect: (t: InMemoryTransport) => Promise<void>; close: () => Promise<void> };

async function connect(server: Connectable): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wave-transports-test", version: PKG_VERSION });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

// buildServer() reads its selection from process.env, exactly as src/server.ts startServer() does.
const stdio = () => connect(buildServer() as unknown as Connectable);
const sdk = async () => connect((await createWaveSdkMcpServer()).instance as unknown as Connectable);

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? "";
}

for (const [transport, open] of [
  ["stdio", stdio],
  ["sdk-server", sdk],
] as const) {
  test(`${transport}: a 404 from the WAVE API is a failed tool call (isError: true)`, async () => {
    nextResponse = { status: 404, body: ROUTE_NOT_FOUND };
    const { client, close } = await open();
    try {
      const result = await client.callTool({ name: "wave_get_subscription", arguments: {} });
      assert.equal(result.isError, true);
      assert.equal(text(result), `Error 404: ${ROUTE_NOT_FOUND}`);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, "https://api.wave.online/v1/billing");
      assert.equal(calls[0]!.authorization, `Bearer ${DUMMY_KEY}`);
    } finally {
      await close();
    }
  });

  test(`${transport}: 401, 402 and 403 answers are failed tool calls too`, async () => {
    for (const status of [401, 402, 403]) {
      nextResponse = { status, body: JSON.stringify({ error: { code: `S${status}` } }) };
      const { client, close } = await open();
      try {
        const result = await client.callTool({ name: "wave_get_usage", arguments: {} });
        assert.equal(result.isError, true, `status ${status}`);
        assert.match(text(result), new RegExp(`^Error ${status}: `));
      } finally {
        await close();
      }
    }
  });

  test(`${transport}: a 2xx is a successful tool call whose text is the API body`, async () => {
    nextResponse = { status: 200, body: BILLING_OK };
    const { client, close } = await open();
    try {
      const result = await client.callTool({ name: "wave_get_subscription", arguments: {} });
      assert.notEqual(result.isError, true);
      assert.equal(text(result), BILLING_OK);
    } finally {
      await close();
    }
  });

  test(`${transport}: default tools/list is the 7 public tools, nothing on an unserved route`, async () => {
    const { client, close } = await open();
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map((t) => t.name).sort(),
        [
          "wave.ask",
          "wave_compose",
          "wave_create_clip",
          "wave_get_subscription",
          "wave_get_usage",
          "wave_get_viewers",
          "wave_start_captions",
        ],
      );
    } finally {
      await close();
    }
  });

  test(`${transport}: WAVE_MCP_EXPERIMENTAL=1 registers wave_list_streams, and its 404 is still isError`, async () => {
    process.env["WAVE_MCP_EXPERIMENTAL"] = "1";
    nextResponse = { status: 404, body: ROUTE_NOT_FOUND };
    const { client, close } = await open();
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 20);
      const streams = tools.find((t) => t.name === "wave_list_streams");
      assert.ok(streams, "wave_list_streams not registered under the opt-in");
      assert.match(streams!.description ?? "", /does not serve this route/);
      const result = await client.callTool({ name: "wave_list_streams", arguments: {} });
      assert.equal(result.isError, true);
      assert.match(calls[0]!.url, /^https:\/\/api\.wave\.online\/v1\/streams\?/);
    } finally {
      await close();
    }
  });
}

test("stdio: with no opt-in the server registers no resources and no resources capability", async () => {
  const { client, close } = await stdio();
  try {
    assert.equal(client.getServerCapabilities()?.resources, undefined);
  } finally {
    await close();
  }
});

test("stdio: opted in, resources/templates/list returns both wave:// templates", async () => {
  process.env["WAVE_MCP_EXPERIMENTAL"] = "1";
  const { client, close } = await stdio();
  try {
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.deepEqual(resourceTemplates.map((t) => t.uriTemplate).sort(), [
      "wave://productions/{id}",
      "wave://streams/{id}",
    ]);
    // A template is not a concrete resource: nothing with a literal "{id}" is listed.
    const { resources } = await client.listResources();
    assert.equal(resources.length, 0);
  } finally {
    await close();
  }
});

test("stdio: resources/read wave://streams/{id} fills {id} and returns the API body", async () => {
  process.env["WAVE_MCP_EXPERIMENTAL"] = "1";
  nextResponse = { status: 200, body: JSON.stringify({ id: "abc-123", status: "idle" }) };
  const { client, close } = await stdio();
  try {
    const result = await client.readResource({ uri: "wave://streams/abc-123" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://api.wave.online/v1/streams/abc-123");
    assert.equal(calls[0]!.authorization, `Bearer ${DUMMY_KEY}`);
    const content = result.contents[0] as { uri: string; text: string; mimeType: string };
    assert.equal(content.uri, "wave://streams/abc-123");
    assert.equal(content.mimeType, "application/json");
    assert.deepEqual(JSON.parse(content.text), { id: "abc-123", status: "idle" });
  } finally {
    await close();
  }
});

test("stdio: resources/read of wave://productions/{id} maps to GET /v1/productions/{id}", async () => {
  process.env["WAVE_MCP_EXPERIMENTAL"] = "1";
  nextResponse = { status: 200, body: JSON.stringify({ id: "p-1" }) };
  const { client, close } = await stdio();
  try {
    await client.readResource({ uri: "wave://productions/p-1" });
    assert.equal(calls[0]!.url, "https://api.wave.online/v1/productions/p-1");
  } finally {
    await close();
  }
});

test("stdio: a non-2xx on resources/read is a JSON-RPC error, never an 'Error 404' resource body", async () => {
  process.env["WAVE_MCP_EXPERIMENTAL"] = "1";
  nextResponse = { status: 404, body: ROUTE_NOT_FOUND };
  const { client, close } = await stdio();
  try {
    await assert.rejects(client.readResource({ uri: "wave://streams/abc-123" }), /WAVE API 404 ROUTE_NOT_FOUND/);
  } finally {
    await close();
  }
});

test("stdio: a resources/read error names the status and gateway code, never the upstream body", async () => {
  process.env["WAVE_MCP_EXPERIMENTAL"] = "1";
  nextResponse = {
    status: 403,
    body: JSON.stringify({
      error: { code: "SCOPE_INSUFFICIENT", request_id: "req_123", message: "org 00000000-dead-beef lacks productions:read" },
    }),
  };
  const { client, close } = await stdio();
  try {
    await assert.rejects(client.readResource({ uri: "wave://productions/p-1" }), (err: Error) => {
      assert.match(err.message, /WAVE API 403 SCOPE_INSUFFICIENT \(request_id req_123\)/);
      assert.doesNotMatch(err.message, /dead-beef|lacks productions/);
      return true;
    });
  } finally {
    await close();
  }
});

test("stdio: a 2xx resources/read that is not JSON is an error, not an application/json resource", async () => {
  process.env["WAVE_MCP_EXPERIMENTAL"] = "1";
  nextResponse = { status: 200, body: "<!DOCTYPE html><title>holding page</title>", contentType: "text/html" };
  const { client, close } = await stdio();
  try {
    await assert.rejects(client.readResource({ uri: "wave://streams/abc-123" }), /not JSON/);
  } finally {
    await close();
  }
});

test("stdio: resources/read refuses redirects (the request carries the bearer key)", async () => {
  process.env["WAVE_MCP_EXPERIMENTAL"] = "1";
  nextResponse = { status: 200, body: JSON.stringify({ id: "abc-123" }) };
  const { client, close } = await stdio();
  try {
    await client.readResource({ uri: "wave://streams/abc-123" });
    assert.equal(calls[0]!.redirect, "error");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Opt-in groups whose handlers read process.env at CALL time (PR #145 review): registration and
// the handler must see the same configuration, on both transports.
// ---------------------------------------------------------------------------

for (const [transport, open] of [
  ["stdio", stdio],
  ["sdk-server", sdk],
] as const) {
  test(`${transport}: wave_voice_converse uses the secret and edge set AFTER import, and a failed bind is isError with the status only`, async () => {
    // This module (and voice.ts) were imported long before these assignments: an import-time
    // capture would register the tool and then report "not set", or call the default edge.
    process.env["WAVE_INTERNAL_SECRET"] = "test-seal-not-a-credential";
    process.env["WAVE_REALTIME_EDGE"] = "https://edge.test.invalid";
    nextResponse = { status: 500, body: JSON.stringify({ ok: false, session: "sess_secret_fragment", ttsEndpoint: "wss://x" }) };
    const { client, close } = await open();
    try {
      const { tools } = await client.listTools();
      assert.ok(tools.some((t) => t.name === "wave_voice_converse"), "voice not registered with the secret set");
      const result = await client.callTool({
        name: "wave_voice_converse",
        arguments: { room: "r1", audioPath: "/nonexistent.wav", outPath: "/nonexistent.pcm" },
      });
      assert.equal(result.isError, true);
      assert.equal(text(result), "voice_converse failed: bind failed: HTTP 500");
      assert.equal(calls[0]!.url, "https://edge.test.invalid/v1/realtime/agents/bind");
      assert.equal(calls[0]!.redirect, "error");
    } finally {
      await close();
    }
  });

  test(`${transport}: a design result with ok:false is a failed tool call carrying the result JSON`, async () => {
    const root = fakePenRegister();
    process.env["WAVE_LOC_STUDY_ROOT"] = root.locStudy;
    const { client, close } = await open();
    try {
      // Neither `image` nor `plate`: measureImpl answers ok:false before running anything.
      const result = await client.callTool({ name: "wave_design_measure", arguments: {} });
      assert.equal(result.isError, true);
      assert.deepEqual(JSON.parse(text(result)), { ok: false, error: "wave_design_measure: one of `image` or `plate` is required" });
    } finally {
      await close();
    }
  });

  test(`${transport}: a design result with ok:true is a successful tool call`, async () => {
    const root = fakePenRegister();
    process.env["WAVE_PEN_EXTRACT_ROOT"] = root.penExtract;
    const contract = join(mkdtempSync(join(tmpdir(), "wave-mcp-contract-")), "design-contract.json");
    writeFileSync(contract, "{}");
    const { client, close } = await open();
    try {
      // Runs the fixture's real designs/contract/validate.mjs in a subprocess (exit 0, prints "valid").
      const result = await client.callTool({ name: "wave_design_contract_check", arguments: { contract } });
      assert.notEqual(result.isError, true);
      const parsed = JSON.parse(text(result)) as { ok: boolean; valid: boolean; validatorLine: string };
      assert.equal(parsed.ok, true);
      assert.equal(parsed.valid, true);
      assert.equal(parsed.validatorLine, "valid");
    } finally {
      await close();
    }
  });
}

/**
 * A runnable fake of the two unpublished design libraries: pen-extract (src/cli.mjs plus its repo's
 * designs/contract/ validator, schema and catalogue) and loc-study (bin/loc-study.mjs). Each
 * script is a real one-liner node can execute.
 */
function fakePenRegister(): { penExtract: string; locStudy: string } {
  const base = mkdtempSync(join(tmpdir(), "wave-mcp-design-libs-"));
  const penExtract = join(base, "pen-register", "packages", "pen-extract");
  const contractDir = join(base, "pen-register", "designs", "contract");
  const locStudy = join(base, "loc-study");
  for (const dir of [join(penExtract, "src"), contractDir, join(locStudy, "bin")]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(penExtract, "src", "cli.mjs"), "process.exit(0);\n");
  writeFileSync(join(contractDir, "validate.mjs"), 'console.log("valid");\n');
  writeFileSync(join(contractDir, "design-contract.schema.json"), "{}");
  writeFileSync(join(contractDir, "acceptance-tests.json"), "[]");
  writeFileSync(join(locStudy, "bin", "loc-study.mjs"), "process.exit(0);\n");
  return { penExtract, locStudy };
}
