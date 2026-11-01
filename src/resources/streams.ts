// cspell:ignore modelcontextprotocol
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEntityResource } from "./entity.js";

/**
 * `wave://streams/{id}` → GET /v1/streams/{id}. The /v1/streams family is unserved on
 * api.wave.online (see ../tools/index.ts), so ../server.ts registers this only when
 * WAVE_MCP_EXPERIMENTAL=1.
 */
export function registerStreamResources(server: McpServer): void {
  registerEntityResource(server, {
    name: "stream",
    uriTemplate: "wave://streams/{id}",
    apiPath: "/v1/streams",
    description: "A WAVE stream with its configuration and status (GET /v1/streams/{id})",
  });
}
