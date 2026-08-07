// Regression test for wave-av/mcp-server#91, resource half.
//
// The two `wave://` resources (stream, production) had the same bug as the 18
// tools: `${getBaseUrl()}/api/v1/...` against the wrong default origin. This
// proves both resource handlers now call https://api.wave.online/v1/*.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerStreamResources } from "./streams.js";
import { registerProductionResources } from "./productions.js";

process.env["WAVE_API_KEY"] = "test-key-not-real";
delete process.env["WAVE_BASE_URL"];

type ResourceHandler = (uri: URL) => Promise<unknown>;

/** Captures the handler a `register*Resources(server)` fn hands to `server.resource(...)`. */
function captureResourceHandler(register: (server: McpServer) => void): ResourceHandler {
  let captured: ResourceHandler | undefined;
  const fakeServer = {
    resource: (_name: string, _template: string, _meta: unknown, handler: ResourceHandler) => {
      captured = handler;
    },
  } as unknown as McpServer;
  register(fakeServer);
  if (!captured) throw new Error("register() never called server.resource()");
  return captured;
}

function fakeResponse(): Response {
  return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) } as Response;
}

async function captureUrl(handler: ResourceHandler, uri: URL): Promise<string | undefined> {
  let capturedUrl: string | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    capturedUrl = typeof input === "string" ? input : input.toString();
    return fakeResponse();
  }) as typeof fetch;
  try {
    await handler(uri);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return capturedUrl;
}

test("wave://streams/{id} resource calls https://api.wave.online/v1/streams/{id}", async () => {
  const handler = captureResourceHandler(registerStreamResources);
  const url = await captureUrl(handler, new URL("wave://streams/stream_123"));
  assert.match(url!, /^https:\/\/api\.wave\.online\/v1\/streams\/stream_123$/);
});

test("wave://productions/{id} resource calls https://api.wave.online/v1/productions/{id}", async () => {
  const handler = captureResourceHandler(registerProductionResources);
  const url = await captureUrl(handler, new URL("wave://productions/prod_123"));
  assert.match(url!, /^https:\/\/api\.wave\.online\/v1\/productions\/prod_123$/);
});
