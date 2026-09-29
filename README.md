<div align="center">

# @wave-av/mcp-server

**WAVE is media infrastructure for the agentic internet: one call shape moves live and on-demand media across every transport, and both kinds of user, people and agents, discover it, call it, and pay for it per call. This package is how an agent discovers and calls that call shape over MCP. The hosted server answers at https://mcp.wave.online/mcp, the agent card is published at https://gateway.wave.online/.well-known/agent-card.json, and the skills index at https://gateway.wave.online/.well-known/wave-skills.json. `npx @wave-av/mcp-server` runs a WAVE MCP server locally over stdio for Claude Code, Cursor, and Windsurf.**

![kind](https://img.shields.io/badge/kind-mcp--server-555?style=flat-square) ![domain](https://img.shields.io/badge/domain-agent--ops-0a7?style=flat-square) ![lang](https://img.shields.io/badge/lang-TypeScript-3178c6?style=flat-square) ![visibility](https://img.shields.io/badge/visibility-public-brightgreen?style=flat-square) ![phase](https://img.shields.io/badge/phase-preview-blue?style=flat-square)

[**Live** →](https://docs.wave.online/mcp) · [docs](https://docs.wave.online/mcp) · [npm](https://www.npmjs.com/package/@wave-av/mcp-server) · [repo](https://github.com/wave-av/mcp-server) · [Docs](https://docs.wave.online) · [Status](https://wave.online/status)

</div>

---

## Quick start

```bash
npx @wave-av/mcp-server
```

```json
{
  "mcpServers": {
    "wave": {
      "command": "npx",
      "args": ["-y", "@wave-av/mcp-server"],
      "env": {
        "WAVE_API_KEY": "wave_live_..."
      }
    }
  }
}
```

## Setup

### 1. Get an API key

```bash
# Via CLI
wave auth login

# Or create at https://console.wave.online/dashboard#keys
```

### 2. Configure your AI tool

Add to your `.mcp.json` (Claude Code, Cursor, Windsurf, etc.) — see the Quick start config above.

## Tools

With `WAVE_API_KEY` set and nothing else, `tools/list` returns **7 tools**. Each one calls a route
`https://api.wave.online` serves, or proposes without calling anything. Other tools are registered
only when their condition holds. See [Opt-in tools](#opt-in-tools) below.

A tool call that the WAVE API answers with a non-2xx status comes back with `isError: true` and the
text `Error <status>: <body>`. Treat it as a failed call, not as output. (Through 0.3.0 these came back
as ordinary results.)

### Analytics and billing

| Tool | Route | Description |
| --- | --- | --- |
| `wave_get_viewers` | `GET /v1/analytics/engagement` | Account-wide viewer engagement analytics over a date range |
| `wave_get_subscription` | `GET /v1/billing` | The current billing account (plan, subscription state) |
| `wave_get_usage` | `GET /v1/billing/usage` | Billed usage for a date range |

### Media

| Tool | Route | Description |
| --- | --- | --- |
| `wave_create_clip` | `POST /v1/clips` | Create a clip from a recording. Priced: expect a 402 (x402 challenge or spend cap) until the account can pay. |
| `wave_start_captions` | `POST /v1/live/pipeline` | Transcribe one audio clip (multipart) and optionally run a fast-LLM step over the transcript. Priced. |

### Compose (front door composer)

`wave_compose` is the agent rendering of the WAVE conversational front door
composer (`designs/front-door/PR4-BRIEF.md` in `wave-pen-register-wt`): given
a goal in plain language, it **proposes** a composition of WAVE
products/tools/meters. It never executes anything itself.

| Tool | Description |
| --- | --- |
| `wave_compose` | Propose a WAVE media pipeline (captions/clips/dub/realtime/identity/...) for a goal stated in plain language. Calls the live gateway `POST /v1/compose` when `WAVE_API_KEY` is configured (`grounding: "gateway"`); falls back to a bundled snapshot composition when no key is set or the live call fails, errors, or times out after 3s (`grounding: "snapshot"`), so it never dead-ends. Propose-only: calls no other tool itself. |
| `wave.ask` | **Deprecated**: use `wave_compose` instead. Kept as an offline-only alias for one release (calls no other tool, makes no network request; identical composition logic to `wave_compose`'s snapshot fallback, without the `grounding` field). |

- **Input**: `{ intent: string, budgetUsd?: number }` (`wave_compose`) / `{ question: string, budgetUsd?: number }` (`wave.ask`, deprecated).
- **Output**: `{ intent, stages[], productIds[], tools[], toolsServer, meters[], priceRows[], executes: false, next[], grounding }` (`wave_compose`; `grounding` is `"gateway"` or `"snapshot"`) or the gateway's own object verbatim plus `grounding: "gateway"` when a live call succeeds. `wave.ask`'s output omits `grounding` but is otherwise identical. Always `executes: false`, never a `model` field (no sourced Dispatch model catalog exists yet).
- **`tools[]` are the hosted server's tools, not this package's.** `toolsServer` says where they live: the hosted WAVE MCP server, `https://api.wave.online/mcp`. Most of them are not registered here. `wave_create_clip` and `wave_get_usage` exist in both places under the same name but take different arguments or call a different route, so call a proposed tool on `toolsServer`.
- **Grounded, not generated, in the snapshot path**: every `productIds[]`/`tools[]`/`meters[]` entry is checked against a bundled, measured snapshot of the live platform (`knowledge/products.json`: 60 products, `knowledge/skills.json`: 180 skills with pricing, `knowledge/mcp-tools.json`: 96 hosted MCP tools, all fetched 2026-09-28; see `knowledge/SOURCES.md` for fetch provenance). A hosted tool whose route wave-gateway lists as served by nothing (38 of the 96: the streams, productions, cameras, editor projects, phone, collab rooms, podcast shows and studio-ai families) is never proposed. A goal the composer doesn't recognize, or one that mentions a name outside that snapshot, always falls back to a real, grounded composition. It never fabricates one and never dead-ends.
- **Pricing is never invented** in the snapshot path: each `priceRows[]` entry carries the skill's real `meter` (or `null` for flat-rate skills) and a `priceShape` read straight off the skill's pricing block; the `quote` field is always `"quote at call time"`.
- **The `WAVE_API_KEY` never goes anywhere but the gateway**: `wave_compose`'s live call sends it only as the `Authorization` header on `POST {WAVE_BASE_URL}/v1/compose`; it is never logged and never echoed into the tool's returned content, including on a failed call (which falls back to the snapshot path instead of surfacing an error).
- See `skills/wave-ask/SKILL.md` for the full agent-facing how-to-call contract.

## Opt-in tools

18 more tools ship in the package but are registered only when their condition holds. The server
logs which opt-in groups are live on startup (group names and counts only, never a value), e.g.
`[wave-mcp-server] Connected via stdio transport — 7 tools (opt-in groups: none)`.
`capabilities.json` lists every one under `exposes.optInMcpTools`.

### Unserved routes: `WAVE_MCP_EXPERIMENTAL=1`

These tools call routes that `https://api.wave.online` does **not** serve today. Measured on
2026-09-28, every one answers an anonymous call with `404 ROUTE_NOT_FOUND` ("No WAVE capability is
served at this path"), while the served control routes `GET /v1/network/surface` and
`GET /v1/x402/facilitator/supported` answered 200 in the same run. The streams routes 404 even for a
key holding `streams:read`/`streams:write`; a key without a family's scope gets
`403 SCOPE_INSUFFICIENT` before routing. wave-gateway lists the `/v1/streams`, `/v1/productions` and
`/v1/cameras` families as advertised with no destination (`src/unserved-advertised-paths.ts`), and it
has no product spoke, gateway-native group or handler for `POST /v1/moderate`. They
stay in the package so a gateway that does serve them (`WAVE_BASE_URL=http://localhost:…`) can
still drive them, and so re-enabling a family is a one-line change once it has a backend. With the
flag set, each description starts with a note saying the default origin cannot answer.

| Tool | Route |
| --- | --- |
| `wave_list_streams` | `GET /v1/streams` |
| `wave_create_stream` | `POST /v1/streams` |
| `wave_start_stream` | `POST /v1/streams/{id}/start` |
| `wave_stop_stream` | `POST /v1/streams/{id}/stop` |
| `wave_get_stream_health` | `GET /v1/streams/{id}/status` |
| `wave_get_stream_metrics` | `GET /v1/streams/{id}/analytics` |
| `wave_mark_highlight` | `POST /v1/streams/{id}/highlights` |
| `wave_list_productions` | `GET /v1/productions` |
| `wave_create_production` | `POST /v1/productions` |
| `wave_switch_camera` | `POST /v1/productions/{id}/camera` |
| `wave_show_graphic` | `POST /v1/productions/{id}/overlay` |
| `wave_control_camera` | `POST /v1/cameras/{id}/control` |
| `wave_moderate_chat` | `POST /v1/moderate` |

The same flag registers the two resource templates, which read the same unserved families:

- `wave://streams/{id}`: `GET /v1/streams/{id}`
- `wave://productions/{id}`: `GET /v1/productions/{id}`

Without the flag the server registers no resources and does not advertise the resources capability.

### Voice: `WAVE_INTERNAL_SECRET` is set

| Tool | Description |
| --- | --- |
| `wave_voice_converse` | Drive a full headless voice-agent turn: bind an agent to a room, send a WAV of the caller's speech, and receive the agent's spoken reply as raw PCM. No browser, no WebRTC. Authenticates with the edge-internal secret, not a customer API key, so it is registered only where that secret is present. |

### Design: the unpublished library resolves on disk

Thin wrappers over the design-to-engineer pipeline's two standalone libraries
(`@wave-av/pen-extract`, `@wave-av/loc-study`), stage E2 of
`wave-pen-register`'s `designs/DESIGN-TO-ENGINEER-SYSTEM.md`. Neither library
is published to npm yet, so each tool resolves its library from a sibling
checkout, `$HOME`-first, with an env override, and is registered only when that
directory exists:

| Tool | Registered when | Description |
| --- | --- | --- |
| `wave_design_extract` | pen-extract resolves | Run pen-extract's `all` pipeline on a `.pen` board; returns the manifest (files, sha256s, owed) |
| `wave_design_contract` | pen-extract resolves | Compose + validate a `design-contract.json` from an extract dir; returns the validator line and key counts |
| `wave_design_contract_check` | pen-extract resolves | Validate an existing `design-contract.json`, no compose |
| `wave_design_measure` | loc-study resolves | Run loc-study's `measure` on an image (masked by geometry) or a rasterized plate SVG |

Every path argument (pen board, extract dir, image, contract file, etc.) is
confined to `$HOME/wave-av` or the OS temp dir. A call outside those roots
is rejected before anything runs. A result with `ok: false` comes back with `isError: true`.

| Env var | Default | Purpose |
| --- | --- | --- |
| `WAVE_PEN_EXTRACT_ROOT` | `$HOME/wave-av/wave-pen-register-wt/packages/pen-extract` | Root of the `@wave-av/pen-extract` checkout |
| `WAVE_LOC_STUDY_ROOT` | `$HOME/wave-av/wave-design-study-wt/tools/loc-study` | Root of the `@wave-av/loc-study` checkout |

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WAVE_API_KEY` | Yes | - | Your WAVE API key (`wave_live_...`) |
| `WAVE_BASE_URL` | No | `https://api.wave.online` | API origin. Tool paths are `/v1/*` on the WAVE gateway. |
| `WAVE_MCP_EXPERIMENTAL` | No | unset | `1` or `true` registers the unserved-route tools and the `wave://` resources (see above) |
| `WAVE_INTERNAL_SECRET` | No | unset | Registers `wave_voice_converse` (WAVE-internal) |
| `WAVE_PEN_EXTRACT_ROOT` / `WAVE_LOC_STUDY_ROOT` | No | see above | Register the design tools (WAVE-internal) |

## In-process (Claude Agent SDK) mode

For consumers already running inside a [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
session, the same tools are available in-process — skipping the stdio subprocess
hop (~50 ms vs ~500 ms cold start). The tool list is shared with the stdio
server (`src/tools/index.ts`), so the two transports never drift.

`@anthropic-ai/claude-agent-sdk` is an **optional peer dependency**: stdio users
never need it. Install it only for this mode:

```bash
npm install @wave-av/mcp-server @anthropic-ai/claude-agent-sdk
```

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createWaveSdkMcpServer } from "@wave-av/mcp-server/sdk-server";

const wave = await createWaveSdkMcpServer();
for await (const message of query({
  prompt: "How much have I been billed this month?",
  options: { mcpServers: { wave }, env: { WAVE_API_KEY: process.env.WAVE_API_KEY } },
})) {
  // handle messages
}
```

## Setup for other AI tools

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wave": {
      "command": "npx",
      "args": ["-y", "@wave-av/mcp-server"],
      "env": { "WAVE_API_KEY": "wave_live_..." }
    }
  }
}
```

### Windsurf

Add to Windsurf MCP settings with the same configuration.

## Troubleshooting

### Server not starting

Verify your API key is set:

```bash
echo $WAVE_API_KEY
```

### Tools not appearing

Restart your AI tool after adding the MCP configuration. Most tools require a restart to detect new MCP servers.

### Connection errors

The MCP server uses stdio transport (no network listener). If you see connection errors, check that `npx` can run successfully:

```bash
npx @wave-av/mcp-server --version
```

### Testing the server

Send a JSON-RPC initialize request to verify:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | npx @wave-av/mcp-server
```

## Related packages

- [@wave-av/sdk](https://www.npmjs.com/package/@wave-av/sdk) — TypeScript SDK (34 API modules)
- [@wave-av/adk](https://www.npmjs.com/package/@wave-av/adk) — Agent Developer Kit
- [@wave-av/cli](https://www.npmjs.com/package/@wave-av/cli) — Command-line interface
- [@wave-av/create-app](https://www.npmjs.com/package/@wave-av/create-app) — Scaffold a new project
- [OpenAPI spec](https://github.com/wave-av/api-spec) — Full API specification

## Development

```bash
cd packages/mcp-server
pnpm install
pnpm run build
pnpm run dev       # Watch mode
pnpm run type-check
```

## License

MIT

## Capabilities

| Capability | Status |
| --- | --- |
| Get account-wide viewer engagement analytics over a date range (GET /v1/analytics/engagement). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Get the current billing account: plan and subscription state (GET /v1/billing). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Get billed usage for a date range (GET /v1/billing/usage). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Create a clip from a recording (POST /v1/clips, priced). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Transcribe one audio clip through the live pipeline and optionally run a fast-LLM step over the transcript (POST /v1/live/pipeline, priced). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Opt-in (WAVE_MCP_EXPERIMENTAL=1): list, create, start and stop streams, read a stream's status and analytics, mark a highlight. api.wave.online does not serve /v1/streams today. | ![scaffolded](https://img.shields.io/badge/scaffolded-orange?style=flat-square) |
| Opt-in (WAVE_MCP_EXPERIMENTAL=1): list and create productions, switch a camera, show a graphic. api.wave.online does not serve /v1/productions today. | ![scaffolded](https://img.shields.io/badge/scaffolded-orange?style=flat-square) |
| Opt-in (WAVE_MCP_EXPERIMENTAL=1): send a control command to a managed camera. api.wave.online does not serve /v1/cameras today. | ![scaffolded](https://img.shields.io/badge/scaffolded-orange?style=flat-square) |
| Opt-in (WAVE_MCP_EXPERIMENTAL=1): moderate a chat message. wave-gateway has no handler for POST /v1/moderate today. | ![scaffolded](https://img.shields.io/badge/scaffolded-orange?style=flat-square) |
| WAVE-internal, registered only when WAVE_INTERNAL_SECRET is set: drive a full headless conversation with the WAVE voice agent (WAV in, PCM reply out, no browser/WebRTC). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| WAVE-internal, registered only when the design library resolves on disk: run pen-extract's mechanical extraction pipeline on a .pen board. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| WAVE-internal, registered only when the design library resolves on disk: compose and validate a design-contract.json from an extract dir. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| WAVE-internal, registered only when the design library resolves on disk: measure a print image or rasterized plate SVG with loc-study. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| WAVE-internal, registered only when the design library resolves on disk: validate an existing design-contract.json against the schema. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Deprecated (use wave_compose): propose a WAVE media pipeline (captions/clips/dub/realtime/...) for a goal in plain language; never executes. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Propose a WAVE media pipeline for a goal in plain language. Calls the live gateway when a key is configured; falls back to a bundled snapshot otherwise. Never executes. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |

## For AI agents

Exposes the MCP tool `wave-mcp-server` over `stdio`.

## The receipts

Every claim below is checked by `npm run verify` against the live repo or endpoint — a non-`pass` verdict fails the gate.

| Claim | How it's verified |
| --- | --- |
| Documentation surface is docs.wave.online/mcp | resolved by grepping `package.json` |
| Published npm package name is @wave-av/mcp-server | resolved by grepping `package.json` |
| wave_control_camera tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| Exposes 7 MCP tools by default (18 more are opt-in, listed in capabilities.json optInMcpTools) | resolved by grepping `capabilities.json` |
| wave_voice_converse tool defined in src/tools/voice.ts | resolved by grepping `src/tools/voice.ts` |
| wave_design_extract tool defined in src/tools/design.ts | resolved by grepping `src/tools/design.ts` |
| wave_design_contract tool defined in src/tools/design.ts | resolved by grepping `src/tools/design.ts` |
| wave_design_measure tool defined in src/tools/design.ts | resolved by grepping `src/tools/design.ts` |
| wave_design_contract_check tool defined in src/tools/design.ts | resolved by grepping `src/tools/design.ts` |
| wave_create_clip tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_create_production tool defined in src/tools/studio.ts | resolved by grepping `src/tools/studio.ts` |
| wave_create_stream tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_get_viewers tool defined in src/tools/analytics.ts | resolved by grepping `src/tools/analytics.ts` |
| wave_list_productions tool defined in src/tools/studio.ts | resolved by grepping `src/tools/studio.ts` |
| wave_list_streams tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_mark_highlight tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_moderate_chat tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_show_graphic tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_start_captions tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_start_stream tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_stop_stream tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_get_stream_health tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_get_stream_metrics tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_get_subscription tool defined in src/tools/billing.ts | resolved by grepping `src/tools/billing.ts` |
| wave_switch_camera tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_get_usage tool defined in src/tools/billing.ts | resolved by grepping `src/tools/billing.ts` |
| Server connects via stdio transport (no network listener) | resolved by grepping `src/server.ts` |
| wave.ask tool defined in src/tools/wave-ask/wave-ask.ts | resolved by grepping `src/tools/wave-ask/wave-ask.ts` |
| wave_compose tool defined in src/tools/wave-ask/wave-compose.ts | resolved by grepping `src/tools/wave-ask/wave-compose.ts` |

## Topics

`wave` · `mcp` · `model-context-protocol` · `ai` · `streaming` · `tools`

---

<div align="center">

**Built by [WAVE Online, LLC](https://wave.online)** · [wave.online](https://wave.online) · [Docs](https://docs.wave.online) · [LinkedIn](https://www.linkedin.com/company/wave-online)

</div>

