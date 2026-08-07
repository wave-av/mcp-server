# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **All 18 tools and both `wave://` resources 404'd against prod (#91).** Every
  request was built as `${WAVE_BASE_URL}/api/v1/...` against a default
  `WAVE_BASE_URL` of `https://wave.online` (the marketing/docs Next.js site).
  `/api/v1/*` is an *internal* path shape within the WAVE platform, not a
  path any client should call — and neither `wave.online` nor
  `api.wave.online` serve it, so every call returned a prerendered Next.js
  404. Fixed the default base URL to `https://api.wave.online` (the gateway)
  and every tool/resource to build `/v1/*` paths, matching the public route
  shape verified live and scope-gated (402 `PAYMENT_REQUIRED`, zero
  credentials, 18/18) for all 18
  tools. `WAVE_BASE_URL` still overrides the origin for anyone pointed at a
  non-default environment.

- The old `https://wave.online` default was also still advertised in
  `MCP-DEBUGGING.md` (shipped in the npm package) and in `.wave/repo.json`
  (the source of truth the README is generated from); both now say
  `https://api.wave.online`. The regression tests added for #91 are now
  type-checked (`tsconfig.test.json`) and run in CI, and the `test` script
  quotes its glob so `src/auth.test.ts` is no longer silently skipped by the
  npm shell's non-recursive `**`.

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
