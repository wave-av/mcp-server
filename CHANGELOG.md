# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-03

Every tool now calls a real `api.wave.online` route with that route's own request
shape, verified by reading each route's live handler. Where a tool's previous
shape disagreed with the deployed route, the tool changed to match the route —
several arguments are renamed or restructured as a result (see **Breaking**
below). All 18 tool names are unchanged.

### Changed

- `wave_list_streams` — status filter is now `idle | live | ended` (was
  `active | idle | error | all`); default page size is 50 (was 25), matching
  `GET /v1/streams`.
- `wave_create_stream` — `recording: { enabled }` replaces the old top-level
  `record` boolean; `privacy: public | private` is new; the unsupported `region`
  argument is removed. Matches `POST /v1/streams`'s `CreateStreamSchema`.
- `wave_get_stream_health` now calls `GET /v1/streams/{id}/status` (the dropped
  `/health` route returned 404).
- `wave_get_stream_metrics` now calls `GET /v1/streams/{id}/analytics` with
  `from`/`to` (ISO timestamps), replacing the non-existent
  `/v1/analytics/streams/{id}/metrics` and its `period`/`granularity` arguments.
- `wave_mark_highlight` gains `duration_seconds` and an explicit `timestamp`
  argument (default: now), matching `POST /v1/streams/{id}/highlights`.
- `wave_list_productions` / `wave_create_production` now call
  `GET`/`POST /v1/productions` (was `/v1/studio/productions`); production status
  values are `setup | rehearsal | live | paused | ended` (was
  `draft | live | ended | all`).
- `wave_show_graphic` body is now `{ overlayId, visible }` (was
  `{ graphic_id, action, data }`), matching the deployed `OverlayToggleSchema` on
  `POST /v1/productions/{id}/overlay`.
- `wave_moderate_chat` now calls `POST /v1/moderate` (was
  `/v1/streams/{id}/chat/{message_id}/moderate`, which 404s).
- `wave_start_captions` now calls `POST /v1/live/pipeline` with a multipart
  audio body (`audio_base64`, `filename`, `stream_id`, caption params, and a
  required `llm_model`), replacing the JSON `{ language, provider }` call to the
  non-existent `/v1/streams/{id}/captions/start`. This is a real behavior
  change, not just a route fix: the live route transcribes ONE provided audio
  chunk and optionally runs a fast-LLM step over it — it does not attach a
  persistent caption feed to a live stream. The tool description says this
  explicitly rather than implying the old "start captions on a stream"
  affordance.
- `wave_create_clip` body now matches the clip route's own validator exactly:
  `source` (a recording ID) + `in` (a time string like `"5s"`) replace
  `stream_id`/`start_time`/`end_time`; `duration`/`out`, `visibility`,
  `formats`, `quality`, `width`/`height`, `fit`, and `spritesheet_frames` are
  new, matching what the route accepts. The unsupported social-export argument
  (`export_to`) is removed — the live route does not accept it.
- `wave_get_subscription` now calls `GET /v1/billing` (was
  `/v1/billing/subscription`, which 404s).
- `wave_get_usage` now takes `from`/`to` (`YYYY-MM-DD`, default current month)
  against `GET /v1/billing/usage`, replacing the non-functional
  `period`/`breakdown` enum arguments.
- `wave_get_viewers` now calls `GET /v1/analytics/engagement` with `from`/`to`
  (was `/v1/analytics/viewers` with `stream_id`/`include_demographics`, which
  the deployed gateway does not route).
- Stream and production resources (`wave://streams/{id}`,
  `wave://productions/{id}`) now `encodeURIComponent` the ID before
  interpolating it into the request path.

### Breaking

- `wave_switch_camera`: argument `switcher_id` is replaced by `production_id`;
  `source_id`/`transition: cut|mix|wipe|dve`/`duration_ms` are replaced by
  `camera_index` (0-15), `bus: program | preview`, and
  `transition: cut | dissolve | wipe | fade`. The tool now calls
  `POST /v1/productions/{id}/camera` — the `/v1/switcher/{id}/control` route it
  called previously returns 403 `SCOPE_INSUFFICIENT` under an unrecognized
  `switcher:write` scope and is not the live camera-switch path.
- `wave_control_camera`: the flat `{ action, pan, tilt, zoom, preset_id }` shape
  is replaced by the deployed discriminated union — a `command` argument
  (`set_iris | set_focus | set_zoom | set_white_balance | set_gain |
  set_shutter | start_recording | stop_recording | start_prerecord |
  autofocus_trigger | set_audio_level | recall_preset | save_preset`) plus the
  fields each variant needs (`value`, `temperature`/`tint`, `angle`,
  `channel`/`level`, `preset_id`, `name`/`slot`). The old pan/tilt/zoom shape
  was never accepted by the live route.

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
- `scripts/smoke-mcp.mjs --all` mode: calls all 18 tools with safe arguments
  (list/GET tools first; creates one stream and one production, exercises their
  lifecycle, then falls back to a nil UUID for tools where creating a resource
  isn't wanted) and prints one row per tool
  (`tool | METHOD path | status | PASS/FAIL`). `.github/workflows/smoke-install.yml`
  now runs this mode.

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

## [0.1.3] to [0.1.8] - 2026-04-02 to 2026-04-03

### Changed

- Six untagged republishes of the 0.1.2 line, `0.1.3` through `0.1.8`, are on the
  npm registry (three on 2026-04-02, three on 2026-04-03). The changes in that
  window were package metadata (`types` and `exports` fields, repository URL and
  directory) and README updates. The tool set was unchanged.

## [0.1.2] - 2026-04-02

### Added

- Initial public release of the MCP server. Exposes tools for AI agents over
  the stdio transport (Model Context Protocol). `0.1.0` and `0.1.1` reached the
  registry on 2026-04-01 ahead of this tagged release and carry the same code line.

[Unreleased]: https://github.com/wave-av/mcp-server/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/wave-av/mcp-server/releases/tag/v0.3.0
[0.2.0]: https://github.com/wave-av/mcp-server/releases/tag/v0.2.0
[0.1.3] to [0.1.8]: https://www.npmjs.com/package/@wave-av/mcp-server?activeTab=versions
[0.1.2]: https://github.com/wave-av/mcp-server/releases/tag/v0.1.2
