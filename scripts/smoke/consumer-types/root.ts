// Consumer-side probe for the ROOT entry point.
//
// Asks the only question a consumer cares about: installed the published
// tarball and nothing else, does `@wave-av/mcp-server` resolve its types?
//
// `typeof import(...)` is a purely type-level reference -- it forces tsc to
// resolve `exports["."].types` and check the declarations it reaches, without
// emitting a runtime import. That matters here: the root entry is the
// executable (`#!/usr/bin/env node`, calls `server.connect(transport)` at top
// level), so a real import would start the MCP server and hang.
// Scope, stated plainly: `dist/index.d.ts` is currently `export {};` — the root
// entry is an executable with no library surface — so this arm today proves
// that the root `types` target RESOLVES and nothing beyond it. That is thin
// because the package is thin at root, not because the check is lax: the moment
// the root gains an export, tsc follows it, and a reference to the optional peer
// leaking into a root-reachable declaration fails this arm. Verified by
// negative control before merge.
export type Root = typeof import("@wave-av/mcp-server");
