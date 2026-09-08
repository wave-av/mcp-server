#!/usr/bin/env node
// Cross-platform, fail-closed replacement for `node --test $(find .ts-out -name
// '*.test.js')`. That shell form has two problems (flagged in PR #121 review):
//   1. Fails OPEN, not closed: if the glob matches nothing, `$(...)` expands to
//      an empty string and `node --test` (no path argument) falls back to its
//      own recursive auto-discovery, which can exit 0 with "tests 0" — CI goes
//      green having run nothing.
//   2. Not portable: `find`/`$(...)` need a POSIX shell; npm's default shell on
//      Windows (cmd.exe) has neither.
// This script walks .ts-out for *.test.js with plain `node:fs`, then runs
// `node --test` with the explicit file list — erroring loudly if the list is
// empty instead of silently degrading to auto-discovery.
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TS_OUT = join(ROOT, ".ts-out");

function findTestFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out = out.concat(findTestFiles(full));
    } else if (entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

const files = findTestFiles(TS_OUT).sort();

if (files.length === 0) {
  console.error(
    `run-tests: no *.test.js files found under ${TS_OUT} — refusing to fall back to node --test's ` +
      "own auto-discovery (which can exit 0 having run nothing). Did `npm run pretest` (tsc -p " +
      "tsconfig.test.json) run first, and does it actually emit .test.js files?",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
