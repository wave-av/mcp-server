# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-09-03

### Fixed

- **Every tool now targets a host and path that actually serve the API (#89).** The default
  `WAVE_BASE_URL` was `https://wave.online` — the marketing/app origin, which 404s on the API
  surface — and every tool requested `/api/v1/*`. Both were wrong, and the two compounded: with
  default configuration none of the 18 tools could ever succeed. The default is now
  `https://api.wave.online` (the WAVE gateway, which is the billing/auth/metering authority) and
  the tool paths are now `/v1/*`, which is the gateway's public path space. The gateway itself
  re-prefixes to the spoke origin's `/api/v1/*` on forward, so `/api/v1/*` was never a valid
  request path for a client. Measured 2026-08-07:
  `POST api.wave.online/v1/streams` → 402 (route exists and is priced),
  `POST api.wave.online/api/v1/streams` → 404, `POST wave.online/api/v1/streams` → 404.
  **This does not remediate already-installed copies** — they stay broken until this ships to npm
  and consumers upgrade.
- `WAVE_BASE_URL`, when explicitly set, is now validated and normalised to its **origin**: surrounding
  whitespace is trimmed, and a path, query or fragment is rejected rather than silently discarded
  (tool paths like `/v1/...` are appended to this value, so anything beyond scheme+host+port corrupts
  every request URL). Validation runs at **startup**, from `startServer()`, so a bad value kills the
  process once with an actionable message instead of failing inside every individual tool call.
- `WAVE_BASE_URL` now refuses a cleartext `http://` origin for a remote host. Every request attaches
  `Authorization: Bearer <WAVE_API_KEY>`, so an `http://` origin would put the API key on the wire in
  the clear. Loopback (`localhost` / `127.0.0.1` / `::1`) is still accepted for local development.
- The API-key-minting URL in the missing-key error is now
  `https://console.wave.online/dashboard#keys`. The previous
  `https://wave.online/settings/api-keys` returned 404, so the one pointer a user got toward
  credentials was dead.
- The MCP `serverInfo` version, the `User-Agent` header and the new `--version`
  flag read the package version at runtime instead of a hard-coded `0.1.0`.

### Added

- `wave-mcp-server --version` and `--help`. The README documented `--version`;
  the binary started the stdio server instead.
- A fresh-install smoke workflow that packs the build, installs the tarball in a
  clean directory on Node 20 and 22, asserts `--version`, the stdio handshake and
  the 18-tool `tools/list`, and makes one live tool call against
  `https://api.wave.online` when the repository secret is present.

### Changed

- Documentation corrected against live probes: the "Staging vs production" table in
  `MCP-DEBUGGING.md` advertised `https://staging.wave.online`, which has no DNS record and has never
  been reachable — it has been removed rather than reworded. The tool count in the same document said
  19; there are 18. The generated `README.md` and its source of truth (`.wave/repo.json`) were both
  updated, so the corrected default and key-minting URL survive the next regeneration.

### Security

- Updated `@anthropic-ai/claude-agent-sdk` to 1.30.0. This unblocks `@hono/node-server`
  2.x and clears the last two runtime advisories on the dependency tree. (#68)

### Release note

Publishing `@wave-av/mcp-server@0.2.1` to npm is a separate, manual operator step (repo release
workflow on a version tag). This change does not run `npm publish`. Every copy already installed
from the published `0.2.0` defaults `WAVE_BASE_URL` to `https://wave.online`, which 404s on every
tool call — those installs stay broken until `0.2.1` ships and consumers upgrade.

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

## [0.1.3] to [0.1.8] - 2026-04-02 to 2026-04-03

### Changed

- Releases are now published via npm trusted publishing (OIDC) with signed
  provenance attestations, replacing token-based authentication in CI.
- Six untagged republishes of the 0.1.2 line, `0.1.3` through `0.1.8`, are on the
  npm registry (three on 2026-04-02, three on 2026-04-03). The changes in that
  window were package metadata (`types` and `exports` fields, repository URL and
  directory) and README updates. The tool set was unchanged.

## [0.1.2] - 2026-04-02

### Added

- Initial public release of the MCP server. Exposes tools for AI agents over
  the stdio transport (Model Context Protocol). `0.1.0` and `0.1.1` reached the
  registry on 2026-04-01 ahead of this tagged release and carry the same code line.

[Unreleased]: https://github.com/wave-av/mcp-server/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/wave-av/mcp-server/releases/tag/v0.2.0
[0.1.3] to [0.1.8]: https://www.npmjs.com/package/@wave-av/mcp-server?activeTab=versions
[0.1.2]: https://github.com/wave-av/mcp-server/releases/tag/v0.1.2
