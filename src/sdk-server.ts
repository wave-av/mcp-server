// In-process Agent SDK server for the WAVE MCP tools.
//
// This maps the SAME tool list as the stdio server (src/tools/index.ts) onto
// the Claude Agent SDK's in-process MCP transport. An in-process server skips
// the stdio subprocess hop (~50ms vs ~500ms cold start) for consumers that are
// already running inside an Agent SDK session.
//
// @anthropic-ai/claude-agent-sdk is an OPTIONAL peer dependency: stdio-only
// consumers never pay for it. It is imported dynamically with a graceful
// fallback so a missing install surfaces a clear, actionable error instead of a
// module-resolution crash at startup.
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { allTools } from "./tools/index.js";
import { PKG_VERSION } from "./version.js";

const AGENT_SDK_MODULE = "@anthropic-ai/claude-agent-sdk";

/**
 * Build an in-process MCP server config exposing every WAVE tool, suitable for
 * the Agent SDK's `mcpServers` option:
 *
 *   import { query } from "@anthropic-ai/claude-agent-sdk";
 *   import { createWaveSdkMcpServer } from "@wave-av/mcp-server/sdk-server";
 *   const wave = await createWaveSdkMcpServer();
 *   for await (const msg of query({ prompt, options: { mcpServers: { wave } } })) { ... }
 *
 * @throws if the optional `@anthropic-ai/claude-agent-sdk` peer dep is absent.
 */
export async function createWaveSdkMcpServer(): Promise<McpSdkServerConfigWithInstance> {
  let sdk: typeof import("@anthropic-ai/claude-agent-sdk");
  try {
    sdk = await import(AGENT_SDK_MODULE);
  } catch (cause) {
    throw new Error(
      `${AGENT_SDK_MODULE} is required for the in-process SDK server but is not installed. ` +
        `Install it as a peer dependency: npm install ${AGENT_SDK_MODULE}`,
      { cause },
    );
  }

  const tools = allTools.map((def) =>
    sdk.tool(def.name, def.description, def.inputSchema, async (args) =>
      def.handler(args as unknown as Record<string, unknown>),
    ),
  );

  return sdk.createSdkMcpServer({
    name: "wave-mcp-server",
    version: PKG_VERSION,
    tools,
  });
}
