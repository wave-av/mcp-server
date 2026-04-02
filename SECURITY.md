# Security policy

## Reporting a vulnerability

If you discover a security vulnerability in `@wave-av/mcp-server`, please report it responsibly.

**Do not open a public issue.**

Instead, email **security@wave.online** with:

- A description of the vulnerability
- Steps to reproduce
- Impact assessment
- Any suggested fix (optional)

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Security measures

- All API calls use HTTPS with TLS 1.3
- API keys are passed via environment variables, never hardcoded
- The MCP server uses stdio transport only (no network listener)
- Dependencies are monitored via Dependabot and npm audit
- Secret scanning and push protection are enabled on this repository
- Rate limiting with automatic retry protects against API abuse
