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
import { mkdtempSync } from "node:fs";
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
}

let calls: Recorded[] = [];
let nextResponse: { status: number; body: string } = { status: 200, body: "{}" };
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

beforeEach(() => {
  calls = [];
  process.env["WAVE_API_KEY"] = DUMMY_KEY;
  process.env["HOME"] = EMPTY_HOME;
  delete process.env["WAVE_BASE_URL"];
  delete process.env["WAVE_MCP_EXPERIMENTAL"];
  delete process.env["WAVE_INTERNAL_SECRET"];
  delete process.env["WAVE_PEN_EXTRACT_ROOT"];
  delete process.env["WAVE_LOC_STUDY_ROOT"];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", authorization: headers.get("authorization") });
    return new Response(nextResponse.body, {
      status: nextResponse.status,
      headers: { "content-type": "application/json" },
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

const stdio = () => connect(buildServer({ ...process.env }) as unknown as Connectable);
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
    await assert.rejects(client.readResource({ uri: "wave://streams/abc-123" }), /WAVE API 404/);
  } finally {
    await close();
  }
});
