// The single source of truth for WAVE MCP tools.
//
// Every tool is declared once, as data, in its area module. This registry groups them by the
// condition under which they can actually work; ../server.ts (stdio McpServer) and ../sdk-server.ts
// (in-process Agent SDK) both register `registeredTools()` from THIS module, so the two transports
// can never drift out of parity — the failure mode that sank the previous sdk-server.ts (a
// hand-maintained parallel list that fabricated tool names).
//
// WHY GROUPS (0.4.0). Through 0.3.0 every tool was registered for every caller. Measured live on
// 2026-09-28 against https://api.wave.online, 13 of the 18 HTTP tools could never succeed for anyone:
// their routes answer 404 ROUTE_NOT_FOUND ("No WAVE capability is served at this path"), with and
// without a key, and the anonymous control routes GET /v1/network/surface and
// GET /v1/x402/facilitator/supported answered 200 in the same run. Five more tools only work on
// WAVE's own machines. A customer's tools/list advertised all of them anyway. Now:
//
//   public            — registered for everyone. Each one calls a route api.wave.online serves.
//   unserved-backend  — opt-in with WAVE_MCP_EXPERIMENTAL=1. The /v1/streams, /v1/productions and
//                       /v1/cameras families are listed by the gateway itself as "advertised while
//                       NOTHING serves them" (wave-gateway src/unserved-advertised-paths.ts,
//                       GA-CONTRACT-001). POST /v1/moderate has no product spoke and no
//                       gateway-native handler either. Kept, not deleted, so a local gateway that does
//                       serve them (WAVE_BASE_URL=http://localhost:…) can still drive them, and so
//                       re-enabling a family is a one-line move once it gets a real spoke.
//   internal-voice    — registered only when WAVE_INTERNAL_SECRET is set (edge-internal auth).
//   internal-design-* — registered only when the unpublished sibling library is on disk with every
//                       file its tools execute (./design-lib.ts penExtractAvailable/locStudyAvailable).
//
// Every predicate takes an env for testability, but a server reads ONE selection: ../server.ts and
// ../sdk-server.ts call enabledGroups() on process.env once, and the handlers read the same
// process.env at call time, so a tool is never advertised under one configuration and run under
// another.
import type { WaveToolDef } from "./shared.js";
import { streamTools } from "./streams.js";
import { studioTools } from "./studio.js";
import { analyticsTools } from "./analytics.js";
import { billingTools } from "./billing.js";
import { productionTools, unservedProductionTools } from "./production.js";
import { voiceAvailable, voiceTools } from "./voice.js";
import { designTools } from "./design.js";
import { locStudyAvailable, penExtractAvailable } from "./design-lib.js";
import { waveAskTools } from "./wave-ask/wave-ask.js";
import { waveComposeTools } from "./wave-ask/wave-compose.js";

/** The env var that opts a caller into the unserved-backend group. */
export const EXPERIMENTAL_ENV_VAR = "WAVE_MCP_EXPERIMENTAL";

/** True when `env` opts into the unserved-backend tools (and the two wave:// resources). */
export function experimentalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[EXPERIMENTAL_ENV_VAR]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * Prepended to every unserved-backend tool's description, so an agent that opted in still reads,
 * before it calls, that the default origin cannot answer.
 */
export const UNSERVED_NOTE =
  "[Opt-in via WAVE_MCP_EXPERIMENTAL=1. api.wave.online does not serve this route (measured " +
  "2026-09-28: 404 ROUTE_NOT_FOUND), so expect this call to fail unless WAVE_BASE_URL points at a " +
  "gateway that serves it.] ";

function markUnserved(tool: WaveToolDef): WaveToolDef {
  return { ...tool, description: UNSERVED_NOTE + tool.description };
}

export type ToolGroupId =
  | "public"
  | "unserved-backend"
  | "internal-voice"
  | "internal-design-pen-extract"
  | "internal-design-loc-study";

export interface ToolGroup {
  readonly id: ToolGroupId;
  /** Human-readable registration condition (also published in capabilities.json optInMcpTools). */
  readonly enabledWhen: string;
  readonly isEnabled: (env: NodeJS.ProcessEnv) => boolean;
  readonly tools: readonly WaveToolDef[];
}

const PEN_EXTRACT_TOOLS = new Set(["wave_design_extract", "wave_design_contract", "wave_design_contract_check"]);
const LOC_STUDY_TOOLS = new Set(["wave_design_measure"]);

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: "public",
    enabledWhen: "always",
    isEnabled: () => true,
    tools: [...analyticsTools, ...billingTools, ...productionTools, ...waveAskTools, ...waveComposeTools],
  },
  {
    id: "unserved-backend",
    enabledWhen: `${EXPERIMENTAL_ENV_VAR}=1`,
    isEnabled: experimentalEnabled,
    tools: [...streamTools, ...studioTools, ...unservedProductionTools].map(markUnserved),
  },
  {
    id: "internal-voice",
    enabledWhen: "WAVE_INTERNAL_SECRET is set",
    isEnabled: voiceAvailable,
    tools: voiceTools,
  },
  {
    id: "internal-design-pen-extract",
    enabledWhen:
      "WAVE_PEN_EXTRACT_ROOT (or $HOME/wave-av/wave-pen-register-wt/packages/pen-extract) is a directory " +
      "holding src/cli.mjs, and ../../designs/contract/ holds validate.mjs, design-contract.schema.json " +
      "and acceptance-tests.json",
    isEnabled: penExtractAvailable,
    tools: designTools.filter((t) => PEN_EXTRACT_TOOLS.has(t.name)),
  },
  {
    id: "internal-design-loc-study",
    enabledWhen:
      "WAVE_LOC_STUDY_ROOT (or $HOME/wave-av/wave-design-study-wt/tools/loc-study) is a directory holding " +
      "bin/loc-study.mjs",
    isEnabled: locStudyAvailable,
    tools: designTools.filter((t) => LOC_STUDY_TOOLS.has(t.name)),
  },
];

/** Every tool this package defines, in any group — the catalogue, not what a caller gets. */
export const allTools: readonly WaveToolDef[] = TOOL_GROUPS.flatMap((g) => g.tools);

/** The tools every caller gets, with no opt-in and nothing internal present. */
export const publicTools: readonly WaveToolDef[] = TOOL_GROUPS.filter((g) => g.id === "public").flatMap(
  (g) => g.tools,
);

/** The groups whose registration condition holds for `env`. */
export function enabledGroups(env: NodeJS.ProcessEnv = process.env): readonly ToolGroup[] {
  return TOOL_GROUPS.filter((g) => g.isEnabled(env));
}

/** The tools to register for `env`: the public group plus every opt-in group whose condition holds. */
export function registeredTools(env: NodeJS.ProcessEnv = process.env): readonly WaveToolDef[] {
  return enabledGroups(env).flatMap((g) => g.tools);
}

// Drift/typo guard: tool names must be unique across the WHOLE catalogue (not just one env's
// selection), and every design tool must land in exactly one design group. Runs once at import
// (cheap) and fails loudly rather than silently shadowing or dropping a tool on either transport.
const seen = new Set<string>();
for (const tool of allTools) {
  if (seen.has(tool.name)) {
    throw new Error(`Duplicate WAVE tool name registered: ${tool.name}`);
  }
  seen.add(tool.name);
}
for (const tool of designTools) {
  if (!seen.has(tool.name)) {
    throw new Error(`Design tool ${tool.name} is in no registry group — add it to PEN_EXTRACT_TOOLS or LOC_STUDY_TOOLS`);
  }
}

export type { WaveToolDef } from "./shared.js";
