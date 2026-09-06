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

## Available tools — Streams

| Tool | Description |
| --- | --- |
| `wave_list_streams` | List streams with pagination and status filtering (idle/live/ended) |
| `wave_create_stream` | Create a new stream (protocol, recording, privacy) |
| `wave_start_stream` | Start a stream |
| `wave_stop_stream` | Stop an active stream |
| `wave_get_stream_health` | Get a stream's current status document |
| `wave_get_stream_metrics` | Get analytics for a single stream over a date range |
| `wave_mark_highlight` | Mark a moment in a stream as a highlight for later clipping |

## Available tools — Studio

| Tool | Description |
| --- | --- |
| `wave_list_productions` | List multi-camera productions |
| `wave_create_production` | Create a new multi-camera production |
| `wave_switch_camera` | Switch the program/preview bus to a camera index in a production |
| `wave_show_graphic` | Show or hide a graphics overlay in a production |
| `wave_control_camera` | Send a control command (iris/focus/zoom/white balance/gain/shutter/recording/audio level/presets) to a managed camera |
| `wave_moderate_chat` | Moderate a chat message in a live stream (block/flag/allow) |
| `wave_start_captions` | Transcribe an audio clip and optionally run a fast-LLM step over the transcript |
| `wave_create_clip` | Create a clip from a recording |

## Available tools — Analytics

| Tool | Description |
| --- | --- |
| `wave_get_viewers` | Get account-wide viewer engagement analytics over a date range |

## Available tools — Billing

| Tool | Description |
| --- | --- |
| `wave_get_subscription` | Get the current billing account (plan, subscription state) |
| `wave_get_usage` | Get billed usage for a date range |

## Design tools

Thin wrappers over the design-to-engineer pipeline's two standalone libraries
(`@wave-av/pen-extract`, `@wave-av/loc-study`) — stage E2 of
`wave-pen-register`'s `designs/DESIGN-TO-ENGINEER-SYSTEM.md`. Neither library
is published to npm yet, so each tool resolves its library from a sibling
checkout, `$HOME`-first, with an env override:

| Tool | Description |
| --- | --- |
| `wave_design_extract` | Run pen-extract's `all` pipeline on a `.pen` board; returns the manifest (files, sha256s, owed) |
| `wave_design_contract` | Compose + validate a `design-contract.json` from an extract dir; returns the validator line and key counts |
| `wave_design_measure` | Run loc-study's `measure` on an image (masked by geometry) or a rasterized plate SVG |
| `wave_design_contract_check` | Validate an existing `design-contract.json`, no compose |

Every path argument (pen board, extract dir, image, contract file, etc.) is
confined to `$HOME/wave-av` or the OS temp dir — a call outside those roots
is rejected before anything runs.

| Env var | Default | Purpose |
| --- | --- | --- |
| `WAVE_PEN_EXTRACT_ROOT` | `$HOME/wave-av/wave-pen-register-wt/packages/pen-extract` | Root of the `@wave-av/pen-extract` checkout |
| `WAVE_LOC_STUDY_ROOT` | `$HOME/wave-av/wave-design-study-wt/tools/loc-study` | Root of the `@wave-av/loc-study` checkout |

## Available tools — Compose (front door composer)

`wave_compose` is the agent rendering of the WAVE conversational front door
composer (`designs/front-door/PR4-BRIEF.md` in `wave-pen-register-wt`): given
a goal in plain language, it **proposes** a composition of WAVE
products/tools/meters — it never executes anything itself.

| Tool | Description |
| --- | --- |
| `wave_compose` | Propose a WAVE media pipeline (captions/clips/dub/realtime/identity/...) for a goal stated in plain language. Calls the live gateway `POST /v1/compose` when `WAVE_API_KEY` is configured (`grounding: "gateway"`); falls back to a bundled snapshot composition when no key is set or the live call fails, errors, or times out after 3s (`grounding: "snapshot"`) — never a dead end. Propose-only: calls no other tool itself. |
| `wave.ask` | **Deprecated** — use `wave_compose` instead. Kept as an offline-only alias for one release (calls no other tool, makes no network request; identical composition logic to `wave_compose`'s snapshot fallback, without the `grounding` field). |

- **Input**: `{ intent: string, budgetUsd?: number }` (`wave_compose`) / `{ question: string, budgetUsd?: number }` (`wave.ask`, deprecated).
- **Output**: `{ intent, stages[], productIds[], tools[], meters[], priceRows[], executes: false, next[], grounding }` (`wave_compose`; `grounding` is `"gateway"` or `"snapshot"`) or the gateway's own object verbatim plus `grounding: "gateway"` when a live call succeeds. `wave.ask`'s output omits `grounding` but is otherwise identical. Always `executes: false`, never a `model` field (no sourced Dispatch model catalog exists yet).
- **Grounded, not generated, in the snapshot path**: every `productIds[]`/`tools[]`/`meters[]` entry is checked against a bundled, measured snapshot of the live platform (`knowledge/products.json` — 59 products, `knowledge/skills.json` — 179 skills with pricing, `knowledge/mcp-tools.json` — 93 live gateway tools; see `knowledge/SOURCES.md` for fetch provenance). A goal the composer doesn't recognize, or one that mentions a name outside that snapshot, always falls back to a real, grounded composition — never a fabricated one and never a dead end.
- **Pricing is never invented** in the snapshot path: each `priceRows[]` entry carries the skill's real `meter` (or `null` for flat-rate skills) and a `priceShape` read straight off the skill's pricing block; the `quote` field is always `"quote at call time"`.
- **The `WAVE_API_KEY` never goes anywhere but the gateway**: `wave_compose`'s live call sends it only as the `Authorization` header on `POST {WAVE_BASE_URL}/v1/compose`; it is never logged and never echoed into the tool's returned content, including on a failed call (which falls back to the snapshot path instead of surfacing an error).
- See `skills/wave-ask/SKILL.md` for the full agent-facing how-to-call contract.

## Available tools — Voice

| Tool | Description |
| --- | --- |
| `wave_voice_converse` | Drive a full headless voice-agent turn: bind an agent to a room, send a WAV of the caller's speech, and receive the agent's spoken reply as raw PCM. No browser, no WebRTC. Requires `WAVE_INTERNAL_SECRET` (edge-internal auth, not the customer API key). |

## Resources

Access WAVE entities directly via the `wave://` URI scheme:

- `wave://streams/{id}` - Stream configuration and status
- `wave://productions/{id}` - Studio production details

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WAVE_API_KEY` | Yes | - | Your WAVE API key |
| `WAVE_BASE_URL` | No | `https://api.wave.online` | API origin. Tool paths are `/v1/*` on the WAVE gateway. |

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
  prompt: "List my active streams",
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
| Control a PTZ camera (pan, tilt, zoom, focus, preset recall/store). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Create a clip from a recorded stream, optionally exporting to social platforms. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Create a new multi-camera studio production. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Create a new stream (protocol, recording, region options). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Drive a full headless conversation with the WAVE voice agent (WAV in, PCM reply out, no browser/WebRTC). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Get real-time stream health metrics (bitrate, frame rate, latency). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Get detailed stream performance metrics (bitrate, latency, quality, error rates). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Get current subscription plan, billing cycle, and feature entitlements. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Get current billing-period usage (streaming minutes, storage, bandwidth). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Get current viewer count and viewer demographics for a stream or account-wide. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| List all studio productions in the WAVE account. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| List all streams in the WAVE account with pagination and status filtering. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Mark a moment in a stream as a highlight for later clipping. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Moderate a chat message in a live stream (block, flag, or allow). | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Show, hide, or update an HTML5 graphics overlay on a production. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Start real-time captions/transcription on a stream. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Start a stream by ID, transitioning it to the active state. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Stop an active stream by ID. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Switch the live program output to a different camera/source in a Cloud Switcher session. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Run pen-extract's mechanical extraction pipeline on a .pen board. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Compose and validate a design-contract.json from an extract dir. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Measure a print image or rasterized plate SVG with loc-study. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
| Validate an existing design-contract.json against the schema. | ![preview](https://img.shields.io/badge/preview-blue?style=flat-square) |
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
| Exposes 25 MCP tools | resolved by grepping `capabilities.json` |
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

