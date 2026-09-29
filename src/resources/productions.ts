// cspell:ignore modelcontextprotocol
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEntityResource } from "./entity.js";

/**
 * `wave://productions/{id}` → GET /v1/productions/{id}. The /v1/productions family is unserved on
 * api.wave.online (see ../tools/index.ts), so ../server.ts registers this only when
 * WAVE_MCP_EXPERIMENTAL=1.
 */
export function registerProductionResources(server: McpServer): void {
  registerEntityResource(server, {
    name: "production",
    uriTemplate: "wave://productions/{id}",
    apiPath: "/v1/productions",
    description: "A WAVE studio production session (GET /v1/productions/{id})",
  });
}
