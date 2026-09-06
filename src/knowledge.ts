// Bundled WAVE knowledge-set snapshot the `wave.ask` composer (src/tools/wave-ask/) is
// grounded against — see knowledge/SOURCES.md (copied verbatim from
// wave-pen-register-wt's designs/front-door/knowledge/SOURCES.md) for the live-fetch
// provenance of every file here. This module never fetches the network: the
// composer must never name a product/tool/meter outside these three static
// snapshots, so they are committed into the repo rather than re-fetched per call.
//
// Loaded via `createRequire` (the same pattern `src/version.ts` already uses to load
// `package.json`) rather than a static `import … from "./x.json"`. That matters for
// path-depth parity between the two build outputs this repo produces from one source
// tree: tsup bundles every entry point into a single file directly under `dist/`
// (`dist/index.js`, `dist/sdk-server.js` — depth 1 under the repo root regardless of
// how deeply the importing source file was nested), while the test compile
// (`tsc -p tsconfig.test.json`, rootDir "./src") mirrors `src/`'s structure into
// `.ts-out/` starting at its own top level. Both of those land this file at exactly
// depth 1 under the repo root ONLY because this module lives directly in `src/`
// (matching `src/version.ts`) — a relative path baked into a nested tool file (e.g.
// `src/tools/wave-ask/*.ts`) would resolve to a different depth in each build and
// break one of the two silently.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface ProductEntry {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly status: string;
  readonly blurb: string;
  readonly [key: string]: unknown;
}

export interface SkillPricing {
  readonly model: string;
  readonly meter: string | null;
  readonly currency: string;
  readonly network: string;
}

export interface SkillEntry {
  readonly name: string;
  readonly path: string;
  readonly summary: string;
  readonly pricing: SkillPricing;
  readonly [key: string]: unknown;
}

export interface McpToolEntry {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

interface ProductsFile {
  readonly master: unknown;
  readonly products: readonly ProductEntry[];
  readonly note?: string;
}

interface McpToolsFile {
  readonly toolCount: number;
  readonly tools: readonly McpToolEntry[];
}

const productsFile = require("../knowledge/products.json") as ProductsFile;
const skillsFile = require("../knowledge/skills.json") as readonly SkillEntry[];
const mcpToolsFile = require("../knowledge/mcp-tools.json") as McpToolsFile;

/** The 59-entry (measured 2026-09-06) product manifest — `wave-products.json`. */
export const KNOWLEDGE_PRODUCTS: readonly ProductEntry[] = productsFile.products;

/** The 179-entry (measured 2026-09-06) skills/pricing manifest — `wave-skills.json`. */
export const KNOWLEDGE_SKILLS: readonly SkillEntry[] = skillsFile;

/** The 93-entry (measured 2026-09-06) live MCP tool listing — `GET /mcp`. */
export const KNOWLEDGE_MCP_TOOLS: readonly McpToolEntry[] = mcpToolsFile.tools;

/** Fail loudly at import if the bundled snapshot drifts from its own measured shape. */
if (KNOWLEDGE_PRODUCTS.length === 0) {
  throw new Error("knowledge/products.json loaded with zero products — bundled snapshot is broken");
}
if (KNOWLEDGE_SKILLS.length === 0) {
  throw new Error("knowledge/skills.json loaded with zero skills — bundled snapshot is broken");
}
if (KNOWLEDGE_MCP_TOOLS.length !== mcpToolsFile.toolCount) {
  throw new Error(
    `knowledge/mcp-tools.json toolCount (${mcpToolsFile.toolCount}) !== tools[].length ` +
      `(${KNOWLEDGE_MCP_TOOLS.length}) — bundled snapshot is internally inconsistent`,
  );
}

/** Every valid `wave-products.json` `products[].id` — the grounding set for `productIds[]`. */
export const PRODUCT_IDS: ReadonlySet<string> = new Set(KNOWLEDGE_PRODUCTS.map((p) => p.id));

/** Every valid live `/mcp` `tools[].name` — the grounding set for `tools[]`. */
export const MCP_TOOL_NAMES: ReadonlySet<string> = new Set(KNOWLEDGE_MCP_TOOLS.map((t) => t.name));

/** Skill entries keyed by name (skill names line up 1:1 with most product ids). */
export const SKILLS_BY_NAME: ReadonlyMap<string, SkillEntry> = new Map(
  KNOWLEDGE_SKILLS.map((s) => [s.name, s]),
);

/** Every non-null `pricing.meter` across the skills manifest — the grounding set for `meters[]`. */
export const METER_NAMES: ReadonlySet<string> = new Set(
  KNOWLEDGE_SKILLS.map((s) => s.pricing.meter).filter((m): m is string => m !== null),
);
