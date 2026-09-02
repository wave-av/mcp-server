# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional `WAVE_INSTALL_CHANNEL` environment variable, forwarded as an
  `X-Wave-Install-Channel` request header on every call. Lets a Skill/manifest-
  generated onboarding config self-declare its install channel apart from a
  hand-written docs install, for WAVE's quarterly usage-attribution reporting
  (see `governance/plans/wave-skills-distribution/E2-USAGE-ATTRIBUTION.md` in
  `wave-av/claude-workstation`). Unset by default — no behavior change for
  anyone who doesn't set it.

### Fixed

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
