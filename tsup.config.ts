import { defineConfig } from "tsup";

export default defineConfig({
  // index.ts = stdio CLI entry; sdk-server.ts = in-process Agent SDK entry.
  entry: ["src/index.ts", "src/sdk-server.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Declarations come from the `tsc --emitDeclarationOnly` pass in the build
  // script, NOT from here. tsup's dts worker unconditionally injects a baseUrl
  // into the compiler options it hands to TypeScript —
  //
  //   node_modules/tsup/dist/rollup.js: baseUrl: compilerOptions.baseUrl || "."
  //
  // — and baseUrl is deprecated in typescript 6, so the worker dies with
  // TS5101 no matter what this repo's tsconfig says (it declares no baseUrl at
  // all). Setting `dts: true` here cannot work until tsup stops injecting it.
  // tsup still owns the JS; tsc owns the .d.ts, and runs second because
  // `clean: true` below wipes dist.
  dts: false,
  shims: true,
  // Optional peer dep — never bundle it; consumers that use the SDK server
  // provide it themselves (see package.json peerDependenciesMeta).
  external: ["@anthropic-ai/claude-agent-sdk"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
