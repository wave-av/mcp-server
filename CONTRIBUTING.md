# Contributing to @wave-av/mcp-server

Thanks for your interest in contributing to the WAVE MCP Server.

## Getting started

1. Fork this repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run type check: `pnpm type-check`
5. Test with Claude Code or Cursor
6. Commit with a descriptive message
7. Open a pull request against `main`

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Type check
pnpm type-check

# Test locally with Claude Code
# Add to .mcp.json:
# { "wave-dev": { "command": "node", "args": ["./dist/index.js"], "env": { "WAVE_API_KEY": "your_key" } } }
```

## Adding a new tool

1. Create the tool definition in `src/tools/` (export a `register<Area>Tools(server)` fn)
2. Add a Zod schema for input validation
3. Call your `register<Area>Tools(server)` from `startServer()` in `src/server.ts`
4. Update `README.md` and `capabilities.json` (`exposes.mcpTools`) with the new tool
5. Test with a real AI client (Claude, Cursor, or Windsurf)

## Code standards

- TypeScript strict mode
- All tools must have Zod input schemas
- All tools must have clear descriptions for AI consumption
- Error messages must be actionable

## Reporting issues

- Use GitHub Issues for bugs and feature requests
- For security issues, see [SECURITY.md](SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
