# MCP debugging cheat-sheet

## Quick setup

Add to your `.mcp.json` (Claude Code, Cursor, Windsurf):

```json
{
  "mcpServers": {
    "wave": {
      "command": "npx",
      "args": ["-y", "@wave-av/mcp-server"],
      "env": {
        "WAVE_API_KEY": "wave_live_your_key_here"
      }
    }
  }
}
```

## Common issues

### "WAVE_API_KEY environment variable is required"

Your `.mcp.json` is missing the `env` block. Add `WAVE_API_KEY` as shown above.

### Tools don't appear in Claude/Cursor

1. Restart your AI tool after editing `.mcp.json`
2. Check the server started: look for `[wave-mcp-server] Connected via stdio transport` in logs
3. Verify `npx @wave-av/mcp-server` runs without errors in a terminal

### "Error 401: Unauthorized"

Your API key is invalid or expired. Generate a new one at [wave.online/developers/keys](https://wave.online/developers/keys).

### "Error 429: Rate limited"

You hit the API rate limit. The server auto-retries twice with backoff. If persistent, check your plan's rate limits at wave.online/settings/billing.

### Tools work but return empty results

Check your WAVE account has data. Create a test stream first:
```
wave_create_stream({ title: "Test stream", protocol: "webrtc" })
```

## Debug mode

Run with verbose logging to see all API calls:

```bash
WAVE_BASE_URL=https://staging.wave.online npx @wave-av/mcp-server
```

## Available tools (19)

### Streams (5)
`wave_list_streams` `wave_create_stream` `wave_start_stream` `wave_stop_stream` `wave_get_stream_health`

### Studio (2)
`wave_list_productions` `wave_create_production`

### Analytics (2)
`wave_get_viewers` `wave_get_stream_metrics`

### Billing (2)
`wave_get_subscription` `wave_get_usage`

### Production (7)
`wave_switch_camera` `wave_create_clip` `wave_show_graphic` `wave_control_camera` `wave_moderate_chat` `wave_start_captions` `wave_mark_highlight`

### Resources
- `wave://streams/{id}` — stream configuration and status
- `wave://productions/{id}` — studio production details

## Staging vs production

| Environment | `WAVE_BASE_URL` | API key prefix |
|------------|----------------|---------------|
| Production | `https://wave.online` (default) | `wave_live_*` |
| Staging | `https://staging.wave.online` | `wave_test_*` |

Override via environment variable:
```json
{
  "env": {
    "WAVE_API_KEY": "wave_test_your_key",
    "WAVE_BASE_URL": "https://staging.wave.online"
  }
}
```
