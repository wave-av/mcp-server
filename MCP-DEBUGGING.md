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
2. Check the server started: look for `[wave-mcp-server] Connected via stdio transport — 7 tools (opt-in groups: none)` in logs
3. Verify `npx -y @wave-av/mcp-server --version` runs without errors in a terminal

### A tool I expected is not in `tools/list`

Since 0.4.0 a default `tools/list` has 7 tools, each on a route `api.wave.online` serves. The
streams, productions, cameras and moderation tools are registered only with
`WAVE_MCP_EXPERIMENTAL=1`, because `api.wave.online` answers their routes with
`404 ROUTE_NOT_FOUND` today. `wave_voice_converse` needs `WAVE_INTERNAL_SECRET`, and the design tools
need their unpublished library on disk. The startup log line names the opt-in groups that are live.
See the README's "Opt-in tools" section.

### Tool results and `isError`

Any non-2xx answer from the WAVE API comes back as a failed tool call: `isError: true`, with the text
`Error <status>: <body>`. Through 0.3.0 the same text came back as a successful result.

### "Error 401: Unauthorized"

Your API key is invalid or expired. Generate a new one at [console.wave.online/dashboard#keys](https://console.wave.online/dashboard#keys).

### "Error 429: Rate limited"

You hit the API rate limit. The server does not retry for you, so wait and call again. If it keeps
happening, check your plan's rate limits in the console at [console.wave.online/dashboard](https://console.wave.online/dashboard).

### "Error 402: payment required"

The route exists and is priced, but the request carried no accepted credential or payment. A 402 from
`api.wave.online` is proof the path is correct — check `WAVE_API_KEY` is set and holds the scope the
route requires (`<resource>:read` for GET, `<resource>:write` for mutating verbs).

### "Error 404: ROUTE_NOT_FOUND"

`{"error":{"code":"ROUTE_NOT_FOUND","message":"No WAVE capability is served at this path."}}` means
the gateway serves nothing at that path, for any key. On `api.wave.online` today that is the answer for
every opt-in `WAVE_MCP_EXPERIMENTAL=1` tool (a key without the family's scope gets
`403 SCOPE_INSUFFICIENT` first). From a default tool, check that `WAVE_BASE_URL` is a WAVE API origin.

### Tools work but return empty results

Check your WAVE account has data, for example with `wave_get_usage` over a date range you know had
activity.

## Pointing at a different API origin

`WAVE_BASE_URL` overrides the API origin (default `https://api.wave.online`). It must be an origin,
not a path — the tools append `/v1/...` themselves. A malformed or non-http(s) value now fails loudly
at startup instead of failing inside every tool call.

```bash
WAVE_BASE_URL=https://api.wave.online npx @wave-av/mcp-server
```

## Available tools (7 by default)

### Analytics and billing (3)
`wave_get_viewers` `wave_get_subscription` `wave_get_usage`

### Media (2)
`wave_create_clip` `wave_start_captions`

### Compose (2)
`wave_compose` `wave.ask` (deprecated)

### Opt-in: `WAVE_MCP_EXPERIMENTAL=1` (13, routes unserved on api.wave.online)
`wave_list_streams` `wave_create_stream` `wave_start_stream` `wave_stop_stream` `wave_get_stream_health`
`wave_get_stream_metrics` `wave_mark_highlight` `wave_list_productions` `wave_create_production`
`wave_switch_camera` `wave_show_graphic` `wave_control_camera` `wave_moderate_chat`

### Opt-in resource templates (same flag)
- `wave://streams/{id}` — `GET /v1/streams/{id}`
- `wave://productions/{id}` — `GET /v1/productions/{id}`

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
