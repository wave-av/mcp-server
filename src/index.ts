import { startServer } from "./server.js";

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error during startup";
  process.stderr.write(`[wave-mcp-server] Fatal: ${message}\n`);
  process.exit(1);
});
