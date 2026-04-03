# @wave-av/mcp-server

[![npm version](https://img.shields.io/npm/v/@wave-av/mcp-server.svg)](https://www.npmjs.com/package/@wave-av/mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/@wave-av/mcp-server.svg)](https://www.npmjs.com/package/@wave-av/mcp-server)
[![license](https://img.shields.io/npm/l/@wave-av/mcp-server.svg)](https://github.com/wave-av/mcp-server/blob/main/LICENSE)

MCP (Model Context Protocol) server that exposes WAVE streaming APIs as tools for AI coding assistants.

## Quick start

```bash
npx @wave-av/mcp-server
```

## Setup

### 1. Get an API key

```bash
# Via CLI
wave auth login

# Or create at https://wave.online/settings/api-keys
```

### 2. Configure your AI tool

Add to your `.mcp.json` (Claude Code, Cursor, Windsurf, etc.):

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

## Available tools

### Streams

| Tool                     | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `wave_list_streams`      | List all streams with pagination and status filtering |
| `wave_create_stream`     | Create a new stream with protocol and privacy options |
| `wave_start_stream`      | Start streaming on an existing stream                 |
| `wave_stop_stream`       | Stop an active stream                                 |
| `wave_get_stream_health` | Get real-time health metrics for a stream             |

### Studio

| Tool                     | Description                          |
| ------------------------ | ------------------------------------ |
| `wave_list_productions`  | List studio production sessions      |
| `wave_create_production` | Create a new multi-camera production |

### Analytics

| Tool                      | Description                             |
| ------------------------- | --------------------------------------- |
| `wave_get_viewers`        | Get current viewer count and breakdown  |
| `wave_get_stream_metrics` | Get detailed stream performance metrics |

### Billing

| Tool                    | Description                              |
| ----------------------- | ---------------------------------------- |
| `wave_get_subscription` | Get current subscription plan and status |
| `wave_get_usage`        | Get current period usage and limits      |

## Resources

Access WAVE entities directly via the `wave://` URI scheme:

- `wave://streams/{id}` - Stream configuration and status
- `wave://productions/{id}` - Studio production details

## Environment variables

| Variable        | Required | Default               | Description       |
| --------------- | -------- | --------------------- | ----------------- |
| `WAVE_API_KEY`  | Yes      | -                     | Your WAVE API key |
| `WAVE_BASE_URL` | No       | `https://wave.online` | API base URL      |

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
