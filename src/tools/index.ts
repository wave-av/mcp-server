// The single source of truth for WAVE MCP tools.
//
// Every tool is declared once, as data, in its area module. This registry
// concatenates them; ../server.ts (stdio McpServer) and ../sdk-server.ts
// (in-process Agent SDK) both consume THIS list, so the two transports can
// never drift out of parity — the failure mode that sank the previous
// sdk-server.ts (a hand-maintained parallel list that fabricated tool names).
import type { WaveToolDef } from "./shared.js";
import { streamTools } from "./streams.js";
import { studioTools } from "./studio.js";
import { analyticsTools } from "./analytics.js";
import { billingTools } from "./billing.js";
import { productionTools } from "./production.js";
import { voiceTools } from "./voice.js";
import { designTools } from "./design.js";

export const allTools: readonly WaveToolDef[] = [
  ...streamTools,
  ...studioTools,
  ...analyticsTools,
  ...billingTools,
  ...productionTools,
  ...voiceTools,
  ...designTools,
];

// Drift/typo guard: tool names must be unique. Runs once at import (cheap) and
// fails loudly rather than silently shadowing a duplicate on either transport.
const seen = new Set<string>();
for (const tool of allTools) {
  if (seen.has(tool.name)) {
    throw new Error(`Duplicate WAVE tool name registered: ${tool.name}`);
  }
  seen.add(tool.name);
}

export type { WaveToolDef } from "./shared.js";
