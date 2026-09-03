# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Tool and resource requests now target the production API host,
  `https://api.wave.online`, with `/v1/...` paths. The previous default,
  `https://wave.online/api/v1/...`, returned an HTML 404 page for every tool call
  on a fresh install of 0.2.0.
- The MCP `serverInfo` version, the `User-Agent` header and the new `--version`
  flag read the package version at runtime instead of a hard-coded `0.1.0`.

### Added

- `wave-mcp-server --version` and `--help`. The README documented `--version`;
  the binary started the stdio server instead.
- A fresh-install smoke workflow that packs the build, installs the tarball in a
  clean directory on Node 20 and 22, asserts `--version`, the stdio handshake and
  the 18-tool `tools/list`, and makes one live tool call against
  `https://api.wave.online` when the repository secret is present.

- The build now emits the TypeScript declaration files (`dist/index.d.ts`,
  `dist/sdk-server.d.ts`) that `package.json` has been advertising via `types`
  and the `exports` map. Previously consumers silently resolved to `any`. The
  release workflow now verifies the declared types entries exist in the packed
  tarball before publishing. Note: `dist/sdk-server.d.ts` type-references the
  optional `@anthropic-ai/claude-agent-sdk` peer dependency, so type-checking
  an import of `@wave-av/mcp-server/sdk-server` without that package installed
  now fails with TS2307 (instead of silently resolving to `any`); install the
  peer dependency to consume that subpath.

### Changed

- Releases are now published via npm trusted publishing (OIDC) with signed
  provenance attestations, replacing token-based authentication in CI.

## [0.2.0]

### Added

- In-process Claude Agent SDK server via the new `@wave-av/mcp-server/sdk-server`
  subpath export (`createWaveSdkMcpServer()`). Skips the stdio subprocess hop for
  consumers already running inside an Agent SDK session. `@anthropic-ai/claude-agent-sdk`
  is an **optional** peer dependency — stdio-only consumers are unaffected.

### Changed

- Tools are now declared once as data (`WaveToolDef[]`) in each area module and
  aggregated in `src/tools/index.ts` (the single source of truth). Both the stdio
  server and the in-process SDK server iterate that one list, guaranteeing 18/18
  parity across transports. The previously duplicated `waveFetch` / content
  helpers are hoisted to `src/tools/shared.ts`.
