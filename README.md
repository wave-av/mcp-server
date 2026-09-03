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
| `wave_list_streams` | List all streams with pagination and status filtering |
| `wave_create_stream` | Create a new stream with protocol and privacy options |
| `wave_start_stream` | Start streaming on an existing stream |
| `wave_stop_stream` | Stop an active stream |
| `wave_get_stream_health` | Get real-time health metrics for a stream |

## Available tools — Studio

| Tool | Description |
| --- | --- |
| `wave_list_productions` | List studio production sessions |
| `wave_create_production` | Create a new multi-camera production |

## Available tools — Analytics

| Tool | Description |
| --- | --- |
| `wave_get_viewers` | Get current viewer count and breakdown |
| `wave_get_stream_metrics` | Get detailed stream performance metrics |

## Available tools — Billing

| Tool | Description |
| --- | --- |
| `wave_get_subscription` | Get current subscription plan and status |
| `wave_get_usage` | Get current period usage and limits |

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

## For AI agents

Exposes the MCP tool `wave-mcp-server` over `stdio`.

## The receipts

Every claim below is checked by `npm run verify` against the live repo or endpoint — a non-`pass` verdict fails the gate.

| Claim | How it's verified |
| --- | --- |
| Documentation surface is docs.wave.online/mcp | resolved by grepping `package.json` |
| Published npm package name is @wave-av/mcp-server | resolved by grepping `package.json` |
| wave_control_camera tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| Exposes 18 MCP tools | resolved by grepping `capabilities.json` |
| wave_create_clip tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_create_production tool defined in src/tools/studio.ts | resolved by grepping `src/tools/studio.ts` |
| wave_create_stream tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_get_viewers tool defined in src/tools/analytics.ts | resolved by grepping `src/tools/analytics.ts` |
| wave_list_productions tool defined in src/tools/studio.ts | resolved by grepping `src/tools/studio.ts` |
| wave_list_streams tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_mark_highlight tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_moderate_chat tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_show_graphic tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_start_captions tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_start_stream tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_stop_stream tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_get_stream_health tool defined in src/tools/streams.ts | resolved by grepping `src/tools/streams.ts` |
| wave_get_stream_metrics tool defined in src/tools/analytics.ts | resolved by grepping `src/tools/analytics.ts` |
| wave_get_subscription tool defined in src/tools/billing.ts | resolved by grepping `src/tools/billing.ts` |
| wave_switch_camera tool defined in src/tools/production.ts | resolved by grepping `src/tools/production.ts` |
| wave_get_usage tool defined in src/tools/billing.ts | resolved by grepping `src/tools/billing.ts` |
| Server connects via stdio transport (no network listener) | resolved by grepping `src/server.ts` |

## Topics

`wave` · `mcp` · `model-context-protocol` · `ai` · `streaming` · `tools`

---

<div align="center">

**Built by [WAVE Online, LLC](https://wave.online)** · [wave.online](https://wave.online) · [Docs](https://docs.wave.online) · [LinkedIn](https://www.linkedin.com/company/wave-online)

</div>

