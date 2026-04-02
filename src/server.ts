// cspell:ignore modelcontextprotocol
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerStreamTools } from "./tools/streams.js";
import { registerStudioTools } from "./tools/studio.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerBillingTools } from "./tools/billing.js";
import { registerProductionTools } from "./tools/production.js";
import { registerStreamResources } from "./resources/streams.js";
import { registerProductionResources } from "./resources/productions.js";

export async function startServer(): Promise<void> {
  const server = new McpServer({
    name: "wave-mcp-server",
    version: "0.1.0",
  });

  // Register tools
  registerStreamTools(server);
  registerStudioTools(server);
  registerAnalyticsTools(server);
  registerBillingTools(server);
  registerProductionTools(server);

  // Register resources (wave:// URI scheme)
  registerStreamResources(server);
  registerProductionResources(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("[wave-mcp-server] Connected via stdio transport\n");
}
