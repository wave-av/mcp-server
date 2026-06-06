import { defineConfig } from "tsup";

export default defineConfig({
  // index.ts = stdio CLI entry; sdk-server.ts = in-process Agent SDK entry.
  entry: ["src/index.ts", "src/sdk-server.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // NOTE: kept false to match the repo's existing build contract — the dts
  // worker trips TS5101 (baseUrl deprecation) under the pinned typescript.
  // Emitting real .d.ts for both entries is a pre-existing follow-up.
  dts: false,
  shims: true,
  // Optional peer dep — never bundle it; consumers that use the SDK server
  // provide it themselves (see package.json peerDependenciesMeta).
  external: ["@anthropic-ai/claude-agent-sdk"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
