# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Updated `@anthropic-ai/claude-agent-sdk` to 1.30.0. This unblocks `@hono/node-server`
  2.x and clears the last two runtime advisories on the dependency tree. (#68)

## [0.2.0] - 2026-08-04

### Added

- In-process Claude Agent SDK server via the new `@wave-av/mcp-server/sdk-server`
  subpath export (`createWaveSdkMcpServer()`). Skips the stdio subprocess hop for
  consumers already running inside an Agent SDK session. `@anthropic-ai/claude-agent-sdk`
  is an **optional** peer dependency — stdio-only consumers are unaffected. (#32)

### Changed

- Tools are now declared once as data (`WaveToolDef[]`) in each area module and
  aggregated in `src/tools/index.ts` (the single source of truth). Both the stdio
  server and the in-process SDK server iterate that one list, guaranteeing 18/18
  parity across transports. The previously duplicated `waveFetch` / content
  helpers are hoisted to `src/tools/shared.ts`. (#32)
- Releases are now published via npm trusted publishing (OIDC) with signed
  provenance attestations, replacing token-based authentication in CI. (#73)
- Published to npm as `@wave-av/mcp-server@0.2.0`.

### Fixed

- The build now emits the TypeScript declaration files (`dist/index.d.ts`,
  `dist/sdk-server.d.ts`) that `package.json` has been advertising via `types`
  and the `exports` map. Previously consumers silently resolved to `any`. The
  release workflow now verifies the declared types entries exist in the packed
  tarball before publishing. Note: `dist/sdk-server.d.ts` type-references the
  optional `@anthropic-ai/claude-agent-sdk` peer dependency, so type-checking
  an import of `@wave-av/mcp-server/sdk-server` without that package installed
  now fails with TS2307 (instead of silently resolving to `any`); install the
  peer dependency to consume that subpath. (#76)

### Security

- Updated `brace-expansion` to 5.0.8, the version that clears the runtime
  advisory on that package. (#67)

## [0.1.2] - 2026-04-02

### Added

- Initial public release of the MCP server. Exposes tools for AI agents over
  the stdio transport (Model Context Protocol).

[Unreleased]: https://github.com/wave-av/mcp-server/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/wave-av/mcp-server/releases/tag/v0.2.0
[0.1.2]: https://github.com/wave-av/mcp-server/releases/tag/v0.1.2
