#!/usr/bin/env -S npx tsx
// CAP-001 — capabilities.json must describe exactly the tools src/tools/index.ts defines, split the
// way that registry splits them (the single source of truth both transports consume, see that
// file's own header comment). It previously listed 18 while 19 were registered: `wave_voice_converse`
// (src/tools/voice.ts) shipped and works, but was never added to the manifest, so every consumer of
// capabilities.json — docs generation, capability-discovery machinery, another agent deciding what
// this server can do — read a fiction.
//
// Since 0.4.0 the registry has groups (see TOOL_GROUPS): the `public` group every caller gets, and
// opt-in groups registered only when their condition holds (WAVE_MCP_EXPERIMENTAL=1, an internal
// secret, an unpublished sibling library on disk). capabilities.json mirrors that split:
//
//   exposes.mcpTools       — the public group: what a customer's tools/list returns with no opt-in.
//                            scripts/smoke-mcp.mjs `capabilities` mode compares a live tools/list to
//                            exactly this list.
//   exposes.optInMcpTools  — every other tool, each with its `group` and `enabledWhen`.
//   tags "N-tools"         — N = the public count.
//
// This is enumeration, not transcription: it imports the real TOOL_GROUPS array (the same objects
// server.ts and sdk-server.ts register with the MCP SDK) rather than grepping tool names out of
// source text. Run directly against source (via tsx) — no build step required, so it can gate a PR
// before `npm run build` runs.
//
//   npx tsx scripts/check-capabilities-drift.ts
//
// Exit 0 only when both lists agree with the registry exactly, in both directions, with matching
// group + enabledWhen for every opt-in tool, and the `N-tools` tag matches. Anything else exits 1.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_GROUPS, publicTools } from "../src/tools/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface OptInEntry {
  name: string;
  group?: string;
  enabledWhen?: string;
}

interface Capabilities {
  exposes?: { mcpTools?: Array<{ name: string }>; optInMcpTools?: OptInEntry[] };
  tags?: string[];
}

const capabilities = JSON.parse(readFileSync(join(ROOT, "capabilities.json"), "utf-8")) as Capabilities;

let ok = true;
function fail(message: string): void {
  ok = false;
  console.error(`FAIL: ${message}`);
}

function compareSets(label: string, declared: string[], registered: string[]): void {
  const declaredOnly = declared.filter((name) => !registered.includes(name));
  const registeredOnly = registered.filter((name) => !declared.includes(name));
  if (declaredOnly.length > 0 || registeredOnly.length > 0) {
    fail(
      `capabilities.json ${label} (${declared.length}) does not match the registry (${registered.length}).\n` +
        `  declared but NOT in the registry: ${declaredOnly.length > 0 ? declaredOnly.join(", ") : "(none)"}\n` +
        `  in the registry but NOT declared: ${registeredOnly.length > 0 ? registeredOnly.join(", ") : "(none)"}`,
    );
  }
}

// 1. exposes.mcpTools === the public group.
const declaredPublic = (capabilities.exposes?.mcpTools ?? []).map((t) => t.name).sort();
const registeredPublic = publicTools.map((t) => t.name).sort();
compareSets("exposes.mcpTools", declaredPublic, registeredPublic);

// 2. exposes.optInMcpTools === every other group, with the right group + condition per tool.
const declaredOptIn = capabilities.exposes?.optInMcpTools ?? [];
const optInGroups = TOOL_GROUPS.filter((g) => g.id !== "public");
compareSets(
  "exposes.optInMcpTools",
  declaredOptIn.map((t) => t.name).sort(),
  optInGroups.flatMap((g) => g.tools.map((t) => t.name)).sort(),
);
for (const group of optInGroups) {
  for (const tool of group.tools) {
    const entry = declaredOptIn.find((t) => t.name === tool.name);
    if (!entry) continue; // already reported by compareSets
    if (entry.group !== group.id || entry.enabledWhen !== group.enabledWhen) {
      fail(
        `capabilities.json optInMcpTools entry for ${tool.name} says group=${JSON.stringify(entry.group)} ` +
          `enabledWhen=${JSON.stringify(entry.enabledWhen)}; the registry says group=${JSON.stringify(group.id)} ` +
          `enabledWhen=${JSON.stringify(group.enabledWhen)}`,
      );
    }
  }
}

// 3. The N-tools tag counts what a caller gets by default.
const toolCountTag = (capabilities.tags ?? []).find((t) => /^\d+-tools$/.test(t));
const expectedTag = `${registeredPublic.length}-tools`;
if (toolCountTag !== expectedTag) {
  fail(
    `capabilities.json "tags" has "${toolCountTag ?? "<no N-tools tag found>"}", ` +
      `expected "${expectedTag}" to match the ${registeredPublic.length} tools registered by default.`,
  );
}

if (!ok) {
  console.error(
    "\nCAP-001: capabilities.json and the MCP tool registry have drifted. Update capabilities.json " +
      "(exposes.mcpTools, exposes.optInMcpTools, the N-tools tag) — and README.md's tool tables + " +
      ".wave/repo.json's capabilities/claims — to match TOOL_GROUPS in src/tools/index.ts.",
  );
  process.exit(1);
}

console.log(
  `CAP-001: capabilities.json matches the registry — ${registeredPublic.length} default tools, ` +
    `${declaredOptIn.length} opt-in tools across ${optInGroups.length} groups — OK`,
);
