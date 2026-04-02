# @wave/mcp-server

MCP (Model Context Protocol) server that exposes WAVE streaming APIs as tools for AI coding assistants.

## Quick Start

```bash
npx @wave/mcp-server
```

## Setup

### 1. Get an API Key

```bash
# Via CLI
wave auth login

# Or create at https://wave.online/settings/api-keys
```

### 2. Configure Your AI Tool

Add to your `.mcp.json` (Claude Code, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "wave": {
      "command": "npx",
      "args": ["-y", "@wave/mcp-server"],
      "env": {
        "WAVE_API_KEY": "wave_live_..."
      }
    }
  }
}
```

## Available Tools

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

## Environment Variables

| Variable        | Required | Default               | Description       |
| --------------- | -------- | --------------------- | ----------------- |
| `WAVE_API_KEY`  | Yes      | -                     | Your WAVE API key |
| `WAVE_BASE_URL` | No       | `https://wave.online` | API base URL      |

## Development

```bash
cd packages/mcp-server
pnpm install
pnpm run build    # Build with tsup
pnpm run dev      # Watch mode
pnpm run type-check  # TypeScript check
```

## License

MIT
