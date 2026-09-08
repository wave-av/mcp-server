# TOOLS

Which tools an agent may reach here. The MCP config is the incumbent; the
block below indexes it and refuses wildcard allowlists and unreviewed remote code.
PROBE (tier: probe, E7): `contracts validate --type tools-contract` judges it.

```yaml tools-contract
version: "0.1"
mcp_config: ".mcp.json"
allowlist: explicit
remote_execution: none
```
