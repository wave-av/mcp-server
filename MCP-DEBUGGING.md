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

Your API key is invalid or expired. Generate a new one at [console.wave.online/dashboard#keys](https://console.wave.online/dashboard#keys).

### "Error 429: Rate limited"

You hit the API rate limit. The server auto-retries twice with backoff. If persistent, check your plan's rate limits in the console at [console.wave.online/dashboard](https://console.wave.online/dashboard).

### "Error 402: payment required"

The route exists and is priced, but the request carried no accepted credential or payment. A 402 from
`api.wave.online` is proof the path is correct — check `WAVE_API_KEY` is set and holds the scope the
route requires (`<resource>:read` for GET, `<resource>:write` for mutating verbs).

### Tools work but return empty results

Check your WAVE account has data. Create a test stream first:
```
wave_create_stream({ title: "Test stream", protocol: "webrtc" })
```

## Pointing at a different API origin

`WAVE_BASE_URL` overrides the API origin (default `https://api.wave.online`). It must be an origin,
not a path — the tools append `/v1/...` themselves. A malformed or non-http(s) value now fails loudly
at startup instead of failing inside every tool call.

```bash
WAVE_BASE_URL=https://api.wave.online npx @wave-av/mcp-server
```

## Available tools (18)

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

## API origin

| Environment | `WAVE_BASE_URL` |
|------------|----------------|
| Production | `https://api.wave.online` (default) |

There is no published staging origin for this package today: `staging.wave.online` does not resolve
(no DNS record, checked 2026-08-07). A previous version of this document listed one — it was never
reachable. If you run a private gateway, point `WAVE_BASE_URL` at its origin:

```json
{
  "env": {
    "WAVE_API_KEY": "your_key",
    "WAVE_BASE_URL": "https://api.wave.online"
  }
}
```
