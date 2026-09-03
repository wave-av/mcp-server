// cspell:ignore modelcontextprotocol
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { assertConfigValid } from "./auth.js";
import { allTools } from "./tools/index.js";
import { PKG_VERSION } from "./version.js";
import { registerStreamResources } from "./resources/streams.js";
import { registerProductionResources } from "./resources/productions.js";

/** Build an McpServer with every WAVE tool + resource registered (no transport). */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: "wave-mcp-server",
    version: PKG_VERSION,
  });

  // Register tools from the single source of truth (src/tools/index.ts).
  for (const tool of allTools) {
    server.tool(tool.name, tool.description, tool.inputSchema, tool.handler);
  }

  // Register resources (wave:// URI scheme)
  registerStreamResources(server);
  registerProductionResources(server);

  return server;
}

export async function startServer(): Promise<void> {
  // Fail loud, at startup, on a malformed WAVE_BASE_URL (#89) — before the transport binds, so a
  // misconfigured server dies with one actionable message instead of failing inside every tool call.
  assertConfigValid();

  const server = buildServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("[wave-mcp-server] Connected via stdio transport\n");
}
