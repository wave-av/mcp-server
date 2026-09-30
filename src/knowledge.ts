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
  /** The hosted server's own self-description: `{ wave: { url, transport } }`. */
  readonly mcpServers?: { readonly wave?: { readonly url?: string; readonly transport?: string } };
}

const productsFile = require("../knowledge/products.json") as ProductsFile;
const skillsFile = require("../knowledge/skills.json") as readonly SkillEntry[];
const mcpToolsFile = require("../knowledge/mcp-tools.json") as McpToolsFile;

/** The 60-entry (measured 2026-09-28) product manifest — `wave-products.json`. */
export const KNOWLEDGE_PRODUCTS: readonly ProductEntry[] = productsFile.products;

/** The 180-entry (measured 2026-09-28) skills/pricing manifest — `wave-skills.json`. */
export const KNOWLEDGE_SKILLS: readonly SkillEntry[] = skillsFile;

/**
 * The 96-entry (measured 2026-09-28) tool listing of the HOSTED WAVE MCP server — `GET /mcp`. These
 * are that server's tools, not this stdio package's: the two vocabularies differ (see the
 * `toolsServer` field the composer attaches to every proposal). 38 of the 96 name a route in an
 * {@link UNSERVED_ROUTE_PREFIXES} family; see {@link UNSERVED_MCP_TOOL_NAMES}.
 */
export const KNOWLEDGE_MCP_TOOLS: readonly McpToolEntry[] = mcpToolsFile.tools;

/** The only hosts a proposal's `toolsServer` may name: WAVE's own hosted MCP endpoints. */
export const HOSTED_MCP_HOSTS: ReadonlySet<string> = new Set(["api.wave.online", "mcp.wave.online"]);

/**
 * True when `url` is a WAVE hosted MCP endpoint: `https:`, a host in {@link HOSTED_MCP_HOSTS} on
 * the default port, path exactly `/mcp`, and no userinfo, query or fragment. Every proposal tells an
 * agent to call `tools[]` at this address, so a snapshot refresh that named any other endpoint
 * (a typo, a staging host, a hostile edit) must stop the package from loading, not steer agents.
 */
export function isTrustedHostedMcpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    HOSTED_MCP_HOSTS.has(parsed.hostname) &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === "/mcp" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.href === `https://${parsed.hostname}/mcp`
  );
}

/**
 * Where the tools in {@link KNOWLEDGE_MCP_TOOLS} are served, read from the same snapshot
 * (`mcpServers.wave.url`) rather than hardcoded, so it moves with the snapshot it describes — and
 * checked against {@link isTrustedHostedMcpUrl} below before anything can use it.
 */
export const HOSTED_MCP_URL: string = mcpToolsFile.mcpServers?.wave?.url ?? "";

/** Fail loudly at import if the bundled snapshot drifts from its own measured shape. */
if (KNOWLEDGE_PRODUCTS.length === 0) {
  throw new Error("knowledge/products.json loaded with zero products — bundled snapshot is broken");
}
if (KNOWLEDGE_SKILLS.length === 0) {
  throw new Error("knowledge/skills.json loaded with zero skills — bundled snapshot is broken");
}
if (!isTrustedHostedMcpUrl(HOSTED_MCP_URL)) {
  throw new Error(
    `knowledge/mcp-tools.json mcpServers.wave.url is ${JSON.stringify(HOSTED_MCP_URL)}, not ` +
      `https://<${[...HOSTED_MCP_HOSTS].join("|")}>/mcp — bundled snapshot is broken`,
  );
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

/**
 * `/v1` route families the gateway itself lists as advertised but served by NOTHING — no product
 * spoke, no gateway-native handler — so every call 404s ROUTE_NOT_FOUND. Copied from wave-gateway
 * `src/unserved-advertised-paths.ts` `UNSERVED_ADVERTISED_PATH_PREFIXES` at origin/main 63372049
 * (GA-CONTRACT-001, 2026-09-28), re-prefixed with `/v1`. The hosted `/mcp` listing in the bundled
 * snapshot still carries tools for these families (GA-CONTRACT-001 stops generating them once it is
 * deployed), so the composer drops them rather than steer an agent at a dead route. Remove an entry
 * only when the gateway removes it from that list.
 */
export const UNSERVED_ROUTE_PREFIXES: readonly string[] = [
  "/v1/streams",
  "/v1/productions",
  "/v1/cameras",
  "/v1/editor/projects",
  "/v1/phone/lines",
  "/v1/phone/calls",
  "/v1/collab/rooms",
  "/v1/podcast/shows",
  "/v1/studio-ai",
];

/** True when `path` (e.g. `/v1/streams/{id}/start`) falls under an {@link UNSERVED_ROUTE_PREFIXES} family. */
export function isUnservedRoute(path: string): boolean {
  return UNSERVED_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The `/v1` route a hosted tool's description names — every generated description carries it as
 * `(METHOD /v1/path…` — or undefined when the description names none.
 */
export function routeOfToolDescription(description: string): string | undefined {
  return /\((?:GET|POST|PUT|PATCH|DELETE) (\/v1\/[^\s.)]+)/.exec(description)?.[1];
}

/** Hosted tools whose own description names a route in an unserved family. */
export const UNSERVED_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(
  KNOWLEDGE_MCP_TOOLS.filter((t) => {
    const route = routeOfToolDescription(t.description);
    return route !== undefined && isUnservedRoute(route);
  }).map((t) => t.name),
);

/** Skill entries keyed by name (skill names line up 1:1 with most product ids). */
export const SKILLS_BY_NAME: ReadonlyMap<string, SkillEntry> = new Map(
  KNOWLEDGE_SKILLS.map((s) => [s.name, s]),
);

/** Every non-null `pricing.meter` across the skills manifest — the grounding set for `meters[]`. */
export const METER_NAMES: ReadonlySet<string> = new Set(
  KNOWLEDGE_SKILLS.map((s) => s.pricing.meter).filter((m): m is string => m !== null),
);
