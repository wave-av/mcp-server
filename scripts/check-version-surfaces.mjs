#!/usr/bin/env node
// VERSION-SURFACE GATE
//
//   node scripts/check-version-surfaces.mjs [pkgDir]
//
// Published @wave-av/mcp-server@0.2.0 answers the MCP `initialize` handshake with
// serverInfo.version = "0.1.0". A client that asks the server what it is gets a wrong
// answer. The cause was a hardcoded literal; the cure is deriving every surface from
// package.json (src/version.ts). This script is the gate that keeps it cured.
//
// It asserts EQUALITY between package.json's version and every place this package
// states its own version. It measures the BUILT artifact over its real interfaces --
// not the source -- because the source being right is not the property that matters;
// the property that matters is what a consumer observes.
//
//   [pkgDir] defaults to the repo root. Point it at an installed copy
//   (node_modules/@wave-av/mcp-server) to gate the artifact a user actually gets.
//
// Surfaces measured:
//   1. serverInfo.version  -- MCP `initialize` over stdio JSON-RPC   (the reported defect)
//   2. serverInfo.name     -- same handshake
//   3. --version           -- stdout
//   4. --help banner       -- first line
//   5. User-Agent          -- captured off the wire from a loopback HTTP server
//   6. src/**/*.ts         -- no hardcoded semver literal outside a documented allowlist
//
// Exit 0 only when every surface agrees. Any disagreement, and any surface that could
// not be measured at all, exits 1 -- an unmeasured surface is a failure, never a pass.
// That distinction is the whole point: the pre-existing scripts/smoke-mcp.mjs PRINTS
// serverInfo.version and asserts nothing, so a server reporting 0.1.0 sails through it.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const PKG_DIR = resolve(process.argv[2] ?? REPO_ROOT);

const RPC_TIMEOUT_MS = 30_000;
const EXPECTED_SERVER_NAME = "wave-mcp-server";

// A dummy, non-functional literal. It exists only so the tool path builds an
// Authorization header and issues the request whose User-Agent we capture. It is
// never a real credential and never leaves the loopback interface.
const DUMMY_KEY = "version-gate-dummy-not-a-credential";

// ---------------------------------------------------------------------------
// Hardcoded-semver allowlist for the src/**/*.ts scan (surface 6).
//
// A semver literal in source is not automatically a bug. The class that MUST stay
// allowed is a version that describes a FORMAT rather than this release: an on-disk
// config-file schema version, a wire/protocol revision, a vendored spec id. Pinning
// those to package.json would be the actual defect -- bumping the package would
// silently claim a config format changed. (This exact false positive was raised and
// correctly rejected in the sibling cli fix.)
//
// The MCP protocol version this package speaks ("2025-06-18") is date-shaped, not
// semver-shaped, so it does not match the scan pattern and needs no entry here.
//
// Each entry needs a file, the literal, and a reason a reviewer can check.
const SEMVER_ALLOWLIST = [
  // { file: "src/lib/config/schema.ts", literal: "1.0.0", reason: "on-disk config FORMAT version; must not track the package version" },
];

const failures = [];
const measured = [];
const fail = (surface, detail) => failures.push(`${surface}: ${detail}`);
const pass = (surface, value) => measured.push(`${surface} = ${value}`);

// ---------------------------------------------------------------------------
// Source of truth.
// ---------------------------------------------------------------------------
const pkgPath = join(PKG_DIR, "package.json");
if (!existsSync(pkgPath)) {
  console.error(`FATAL: no package.json at ${pkgPath}`);
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const EXPECTED = pkg.version;
if (typeof EXPECTED !== "string" || !/^\d+\.\d+\.\d+/.test(EXPECTED)) {
  console.error(`FATAL: package.json version is not a semver string: ${JSON.stringify(EXPECTED)}`);
  process.exit(1);
}

// When gating an installed copy, the artifact must have been packed from THIS repo
// state. Without this a stale tarball would be measured against its own stale
// package.json and agree with itself -- green, and wrong.
if (PKG_DIR !== REPO_ROOT) {
  const repoVersion = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
  if (repoVersion !== EXPECTED) {
    fail("artifact freshness", `installed copy is ${EXPECTED} but the repo is ${repoVersion} — stale tarball under test`);
  }
}

// The bin is read from the manifest rather than hardcoded, so renaming it cannot
// silently route this gate at a path that no longer exists.
const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[EXPECTED_SERVER_NAME];
if (!binRel) {
  console.error(`FATAL: package.json declares no bin for ${EXPECTED_SERVER_NAME}`);
  process.exit(1);
}
const BIN = resolve(PKG_DIR, binRel);
if (!existsSync(BIN)) {
  console.error(`FATAL: declared bin does not exist: ${BIN} — run \`npm run build\` first`);
  process.exit(1);
}

console.log(`package under test : ${PKG_DIR}`);
console.log(`bin                : ${BIN}`);
console.log(`expected version   : ${EXPECTED}\n`);

// ---------------------------------------------------------------------------
// Minimal MCP stdio client. Newline-delimited JSON-RPC, argv array, never a shell.
// ---------------------------------------------------------------------------
function openServer(env) {
  const child = spawn(process.execPath, [BIN], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
  const pending = new Map();
  let buf = "";
  let nextId = 1;
  let exited = null;

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* server stdout that is not JSON-RPC is not this gate's concern */
      }
    }
  });
  child.stderr.on("data", (c) => process.stderr.write(`  [server stderr] ${c.toString().slice(0, 300)}`));
  child.on("exit", (code, signal) => {
    exited = `code=${code} signal=${signal}`;
    for (const [, resolveFn] of pending) resolveFn({ __exited: exited });
    pending.clear();
  });

  const rpc = (method, params) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((res, rej) => {
      pending.set(id, res);
      setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), RPC_TIMEOUT_MS).unref();
    });
  };
  const notify = (method, params) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);

  return { child, rpc, notify, close: () => child.kill() };
}

async function handshake(server) {
  const init = await server.rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "wave-version-gate", version: "0.0.0" },
  });
  if (init.__exited) throw new Error(`server exited during initialize (${init.__exited})`);
  return init.result?.serverInfo ?? {};
}

function run(args, env) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.stderr.on("data", (c) => (err += c.toString()));
    child.on("exit", (code) => res({ code, out, err }));
  });
}

// ---------------------------------------------------------------------------
// Surfaces 1 + 2 — MCP initialize / serverInfo. THE REPORTED DEFECT.
// ---------------------------------------------------------------------------
async function checkServerInfo() {
  const server = openServer({});
  try {
    const info = await handshake(server);
    if (info.version === undefined) {
      fail("serverInfo.version", "handshake returned no serverInfo.version at all");
    } else if (info.version !== EXPECTED) {
      fail("serverInfo.version", `MCP initialize reports "${info.version}", package.json says "${EXPECTED}"`);
    } else {
      pass("serverInfo.version", info.version);
    }

    if (info.name !== EXPECTED_SERVER_NAME) {
      fail("serverInfo.name", `reports "${info.name}", expected "${EXPECTED_SERVER_NAME}"`);
    } else {
      pass("serverInfo.name", info.name);
    }
  } catch (e) {
    fail("serverInfo", `could not be measured: ${e.message}`);
  } finally {
    server.close();
  }
}

// ---------------------------------------------------------------------------
// Surface 3 — `--version`.
// ---------------------------------------------------------------------------
async function checkVersionFlag() {
  const { code, out, err } = await run(["--version"], {});
  const got = out.trim();
  if (code !== 0) {
    fail("--version", `exited ${code} (${err.trim().slice(0, 200)})`);
  } else if (got !== EXPECTED) {
    fail("--version", `prints "${got}", package.json says "${EXPECTED}"`);
  } else {
    pass("--version", got);
  }
}

// ---------------------------------------------------------------------------
// Surface 4 — the `--help` banner.
//
// Compared for EQUALITY on an extracted capture, not by grepping the expected string
// out of the output. A substring grep passes when the banner is missing entirely, which
// is a silent hole rather than a gate.
// ---------------------------------------------------------------------------
async function checkHelpBanner() {
  const { code, out, err } = await run(["--help"], {});
  if (code !== 0) {
    fail("--help banner", `exited ${code} (${err.trim().slice(0, 200)})`);
    return;
  }
  const m = out.match(/^wave-mcp-server\s+(\S+)/m);
  if (!m) {
    fail("--help banner", `no "wave-mcp-server <version>" banner line found in --help output`);
    return;
  }
  if (m[1] !== EXPECTED) {
    fail("--help banner", `reports "${m[1]}", package.json says "${EXPECTED}"`);
  } else {
    pass("--help banner", m[1]);
  }
}

// ---------------------------------------------------------------------------
// Surface 5 — the outbound User-Agent, captured OFF THE WIRE.
//
// getAuthHeaders() sends `User-Agent: wave-mcp-server/<version>`. Reading that back out
// of the bundle would only prove the source shape; binding a loopback listener and
// driving a real tools/call proves what the gateway would actually receive.
//
// 127.0.0.1 only, ephemeral port, closed in a finally. WAVE_BASE_URL accepts a loopback
// http:// origin by design (src/auth.ts) precisely so local wiring like this works.
// ---------------------------------------------------------------------------
async function checkUserAgent() {
  let seenUA;
  let requestCount = 0;
  const httpServer = createServer((req, res) => {
    requestCount += 1;
    seenUA = req.headers["user-agent"];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [] }));
  });

  try {
    await new Promise((res) => httpServer.listen(0, "127.0.0.1", res));
    const { port } = httpServer.address();
    const server = openServer({
      WAVE_BASE_URL: `http://127.0.0.1:${port}`,
      WAVE_API_KEY: DUMMY_KEY,
    });
    try {
      await handshake(server);
      server.notify("notifications/initialized", {});
      const call = await server.rpc("tools/call", { name: "wave_list_streams", arguments: {} });
      if (call.__exited) throw new Error(`server exited during tools/call (${call.__exited})`);
    } finally {
      server.close();
    }

    if (requestCount === 0) {
      fail("User-Agent", "no request reached the loopback listener — the surface was never exercised");
    } else if (seenUA === undefined) {
      fail("User-Agent", "request arrived with no User-Agent header");
    } else if (seenUA !== `${EXPECTED_SERVER_NAME}/${EXPECTED}`) {
      fail("User-Agent", `wire header is "${seenUA}", expected "${EXPECTED_SERVER_NAME}/${EXPECTED}"`);
    } else {
      pass("User-Agent (on the wire)", seenUA);
    }
  } catch (e) {
    fail("User-Agent", `could not be measured: ${e.message}`);
  } finally {
    httpServer.close();
  }
}

// ---------------------------------------------------------------------------
// Surface 6 — no hardcoded semver literal in src/.
//
// Surfaces 1-5 catch a drifted version on an interface this gate knows about. This
// catches the NEXT one: a new header, banner or telemetry field that hardcodes a
// literal instead of importing PKG_VERSION. That is the defect CLASS -- correcting a
// literal to today's number just reproduces the bug at the next release.
//
// Whole-line comments are skipped: prose is not a version surface, and this repo
// documents heavily. Anything inside real code is scanned.
// ---------------------------------------------------------------------------
function walkTs(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(p, acc);
    else if (entry.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

function checkSourceLiterals() {
  const srcDir = join(REPO_ROOT, "src");
  if (!existsSync(srcDir)) {
    fail("source scan", `${srcDir} does not exist — the scan could not run, which is not a pass`);
    return;
  }
  const files = walkTs(srcDir);
  if (files.length === 0) {
    fail("source scan", "found no .ts files under src/ — the scan could not run, which is not a pass");
    return;
  }

  // A quoted string that is ENTIRELY a semver, or a semver in a `name/x.y.z` agent string.
  //
  // The quoted pattern is anchored to both quotes on purpose. A looser
  // /["'`](\d+\.\d+\.\d+[^"'`]*)["'`]/ flags `"127.0.0.1"` in src/auth.ts's loopback check
  // — an IPv4 address, whose first three octets are shaped exactly like a semver. That is a
  // false positive, not an allowlist candidate: it is not a version at all, so recording it
  // as a permitted "version literal" would be a lie in the allowlist and would blind the scan
  // to a real literal added to that same line later. Requiring the closing quote immediately
  // after the third component rejects every 4-octet address while still catching `"0.1.0"`.
  const QUOTED = /["'`]v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)["'`]/g;
  const AGENT = /[A-Za-z][\w.-]*\/(\d+\.\d+\.\d+)(?![\d.])/g;

  const hits = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // whole-line comment
      for (const re of [QUOTED, AGENT]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          const literal = m[1];
          const allowed = SEMVER_ALLOWLIST.some((a) => a.file === rel && literal.startsWith(a.literal));
          if (!allowed) hits.push(`${rel}:${i + 1} ${line.trim().slice(0, 120)}`);
        }
      }
    });
  }

  if (hits.length > 0) {
    fail(
      "source scan",
      `hardcoded version literal(s) under src/ — derive from PKG_VERSION (src/version.ts), or add a ` +
        `documented SEMVER_ALLOWLIST entry if it is a config-FORMAT version:\n    ` + hits.join("\n    "),
    );
  } else {
    pass("source scan", `${files.length} .ts files, 0 hardcoded semver literals`);
  }
}

// ---------------------------------------------------------------------------
await checkServerInfo();
await checkVersionFlag();
await checkHelpBanner();
await checkUserAgent();
checkSourceLiterals();

console.log("measured:");
for (const m of measured) console.log(`  ok   ${m}`);

if (failures.length > 0) {
  console.error("\nVERSION-SURFACE GATE FAILED:");
  for (const f of failures) console.error(`  ::error::${f}`);
  console.error(
    `\n${failures.length} surface(s) disagree with package.json (${EXPECTED}). Every version this ` +
      `package states about itself must derive from package.json — see src/version.ts.`,
  );
  process.exit(1);
}

console.log(`\nVERSION-SURFACE GATE PASSED: all ${measured.length} surfaces report ${EXPECTED}`);
