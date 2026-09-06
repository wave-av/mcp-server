import { startServer } from "./server.js";
import { PKG_VERSION } from "./version.js";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${PKG_VERSION}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      `wave-mcp-server ${PKG_VERSION}`,
      "",
      "Usage: wave-mcp-server            start the MCP server over stdio",
      "       wave-mcp-server --version  print the version and exit",
      "       wave-mcp-server --help     print this message and exit",
      "",
      "Environment: WAVE_API_KEY (required), WAVE_BASE_URL (optional)",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error during startup";
  process.stderr.write(`[wave-mcp-server] Fatal: ${message}\n`);
  process.exit(1);
});
