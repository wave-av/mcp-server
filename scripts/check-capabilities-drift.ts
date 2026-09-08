#!/usr/bin/env -S npx tsx
// CAP-001 — capabilities.json (exposes.mcpTools + the `${n}-tools` tag) must list exactly the
// tools `allTools` actually registers (src/tools/index.ts — the single source of truth both
// transports consume, see that file's own header comment). It previously listed 18 while 19 were
// registered: `wave_voice_converse` (src/tools/voice.ts) shipped and works, but was never added to
// the manifest, so every consumer of capabilities.json — docs generation, capability-discovery
// machinery, another agent deciding what this server can do — read a fiction.
//
// This is enumeration, not transcription: it imports the real `allTools` array (the same object
// server.ts and sdk-server.ts iterate to register tools with the MCP SDK) rather than grepping
// tool names out of source text. Run directly against source (via tsx) — no build step required,
// so it can gate a PR before `npm run build` runs.
//
//   npx tsx scripts/check-capabilities-drift.ts
//
// Exit 0 only when capabilities.json and the registered surface agree exactly, in both
// directions (declared-but-not-registered AND registered-but-not-declared each fail), and the
// `${n}-tools` tag matches the real count. Any other outcome exits 1.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allTools } from "../src/tools/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface Capabilities {
  exposes?: { mcpTools?: Array<{ name: string }> };
  tags?: string[];
}

const capabilities = JSON.parse(
  readFileSync(join(ROOT, "capabilities.json"), "utf-8"),
) as Capabilities;

const declared = [...(capabilities.exposes?.mcpTools ?? []).map((t) => t.name)].sort();
const registered = [...allTools.map((t) => t.name)].sort();

let ok = true;
function fail(message: string): void {
  ok = false;
  console.error(`FAIL: ${message}`);
}

const declaredOnly = declared.filter((name) => !registered.includes(name));
const registeredOnly = registered.filter((name) => !declared.includes(name));

if (declaredOnly.length > 0 || registeredOnly.length > 0) {
  fail(
    `capabilities.json exposes.mcpTools (${declared.length}) does not match the ${registered.length} ` +
      `tools registered in allTools (src/tools/index.ts).\n` +
      `  declared in capabilities.json but NOT registered: ${declaredOnly.length > 0 ? declaredOnly.join(", ") : "(none)"}\n` +
      `  registered but NOT declared in capabilities.json:  ${registeredOnly.length > 0 ? registeredOnly.join(", ") : "(none)"}`,
  );
}

const toolCountTag = (capabilities.tags ?? []).find((t) => /^\d+-tools$/.test(t));
const expectedTag = `${registered.length}-tools`;
if (toolCountTag !== expectedTag) {
  fail(
    `capabilities.json "tags" has "${toolCountTag ?? "<no N-tools tag found>"}", ` +
      `expected "${expectedTag}" to match the ${registered.length} tools actually registered.`,
  );
}

if (!ok) {
  console.error(
    "\nCAP-001: capabilities.json and the registered MCP tool surface have drifted. " +
      "Update capabilities.json (exposes.mcpTools + the N-tools tag) — and README.md's tool " +
      "tables + .wave/repo.json's capabilities/claims — to match src/tools/index.ts, or remove " +
      "the tool from allTools if it should not ship.",
  );
  process.exit(1);
}

console.log(`CAP-001: capabilities.json matches all ${registered.length} registered MCP tools — OK`);
