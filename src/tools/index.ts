// The single source of truth for WAVE MCP tools.
//
// Every tool is declared once, as data, in its area module. This registry
// concatenates them; ../server.ts (stdio McpServer) and ../sdk-server.ts
// (in-process Agent SDK) both consume THIS list, so the two transports can
// never drift out of parity — the failure mode that sank the previous
// sdk-server.ts (a hand-maintained parallel list that fabricated tool names).
import type { WaveToolDef } from "./shared.js";
import { studioTools } from "./studio.js";
import { analyticsTools } from "./analytics.js";
import { billingTools } from "./billing.js";
import { productionTools } from "./production.js";
import { voiceTools } from "./voice.js";
import { designTools } from "./design.js";
import { waveAskTools } from "./wave-ask/wave-ask.js";
import { waveComposeTools } from "./wave-ask/wave-compose.js";
import { transportTools } from "./transport.js";

// wave_list_streams / wave_create_stream / wave_start_stream / wave_stop_stream /
// wave_get_stream_health / wave_get_stream_metrics / wave_mark_highlight (src/tools/streams.ts,
// GA-scope duplicate of the /v1/streams surface, ruled "preview" — see the platform's go-live
// kit) were REMOVED, not preview-flagged: the transport lane serves the real GA surface below
// instead (MoQ, braid, SRT, WHIP/WHEP, listen, crest, dante-observe, engine capabilities). No
// phone-line tools ever existed in this package's registry.
export const allTools: readonly WaveToolDef[] = [
  ...transportTools,
  ...studioTools,
  ...analyticsTools,
  ...billingTools,
  ...productionTools,
  ...voiceTools,
  ...designTools,
  ...waveAskTools,
  ...waveComposeTools,
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
