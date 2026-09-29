// cspell:ignore modelcontextprotocol
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { assertConfigValid } from "./auth.js";
import { enabledGroups, experimentalEnabled, registeredTools } from "./tools/index.js";
import { PKG_VERSION } from "./version.js";
import { registerStreamResources } from "./resources/streams.js";
import { registerProductionResources } from "./resources/productions.js";

/**
 * Build an McpServer with the WAVE tools + resources that can work for `env` (no transport).
 * See src/tools/index.ts for the groups and their registration conditions.
 */
export function buildServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer({
    name: "wave-mcp-server",
    version: PKG_VERSION,
  });

  // Register tools from the single source of truth (src/tools/index.ts).
  for (const tool of registeredTools(env)) {
    server.tool(tool.name, tool.description, tool.inputSchema, tool.handler);
  }

  // wave://streams/{id} and wave://productions/{id} read GET /v1/streams/{id} and
  // GET /v1/productions/{id}, both unserved on api.wave.online, so they share the tools' opt-in.
  // With no resource registered the server does not advertise the resources capability at all.
  if (experimentalEnabled(env)) {
    registerStreamResources(server);
    registerProductionResources(server);
  }

  return server;
}

export async function startServer(): Promise<void> {
  // Fail loud, at startup, on a malformed WAVE_BASE_URL (#89) — before the transport binds, so a
  // misconfigured server dies with one actionable message instead of failing inside every tool call.
  assertConfigValid();

  const server = buildServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Group ids and counts only — never an env value. Says which opt-in groups are live, so a user who
  // expected a tool can see why it is (or is not) in tools/list.
  const groups = enabledGroups();
  const optIns = groups.filter((g) => g.id !== "public").map((g) => g.id);
  process.stderr.write(
    `[wave-mcp-server] Connected via stdio transport — ${registeredTools().length} tools ` +
      `(opt-in groups: ${optIns.length > 0 ? optIns.join(", ") : "none"})\n`,
  );
}
