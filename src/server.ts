// cspell:ignore modelcontextprotocol
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { assertConfigValid } from "./auth.js";
import { enabledGroups, type ToolGroup } from "./tools/index.js";
import { PKG_VERSION } from "./version.js";
import { registerStreamResources } from "./resources/streams.js";
import { registerProductionResources } from "./resources/productions.js";

/**
 * Build an McpServer with the WAVE tools + resources of `groups` (no transport).
 *
 * `groups` is ONE selection, computed once from process.env by {@link enabledGroups} — the same
 * process.env every handler reads at call time (the API key, the base URL, the voice secret, the
 * design-library roots). It is a parameter so the caller can log exactly the selection it
 * registered (see {@link startServer}); it is not a way to hand this server a different
 * configuration, which the handlers would not see. See src/tools/index.ts for the groups and their
 * registration conditions.
 */
export function buildServer(groups: readonly ToolGroup[] = enabledGroups()): McpServer {
  const server = new McpServer({
    name: "wave-mcp-server",
    version: PKG_VERSION,
  });

  // Register tools from the single source of truth (src/tools/index.ts).
  for (const tool of groups.flatMap((g) => g.tools)) {
    server.tool(tool.name, tool.description, tool.inputSchema, tool.handler);
  }

  // wave://streams/{id} and wave://productions/{id} read GET /v1/streams/{id} and
  // GET /v1/productions/{id}, both unserved on api.wave.online, so they ride the same opt-in as the
  // unserved-backend tools. With no resource registered the server does not advertise the
  // resources capability at all.
  if (groups.some((g) => g.id === "unserved-backend")) {
    registerStreamResources(server);
    registerProductionResources(server);
  }

  return server;
}

export async function startServer(): Promise<void> {
  // Fail loud, at startup, on a malformed WAVE_BASE_URL (#89) — before the transport binds, so a
  // misconfigured server dies with one actionable message instead of failing inside every tool call.
  assertConfigValid();

  // Evaluated once: the design groups stat the filesystem, so a second evaluation could disagree
  // with the first and the log line below would describe a server that was never built.
  const groups = enabledGroups();
  const server = buildServer(groups);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Group ids and counts only — never an env value. Says which opt-in groups are live, so a user who
  // expected a tool can see why it is (or is not) in tools/list.
  const toolCount = groups.reduce((n, g) => n + g.tools.length, 0);
  const optIns = groups.filter((g) => g.id !== "public").map((g) => g.id);
  process.stderr.write(
    `[wave-mcp-server] Connected via stdio transport — ${toolCount} tools ` +
      `(opt-in groups: ${optIns.length > 0 ? optIns.join(", ") : "none"})\n`,
  );
}
