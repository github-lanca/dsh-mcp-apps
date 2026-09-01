# Changelog

## Unreleased

- Upgrade DSH dependencies to the `0.1.2-alpha.3` line.
- Turn the plugin into a manager that reads an editable `mcp-apps` settings namespace and connects to each listed server.
- Add a dedicated "MCP Apps" settings section in the Web UI that supports editing, adding, and removing MCP servers, with a restart-required reminder after a save.
- Keep `headers`/`env` as `role('secret')` fields (Host-only) and re-merge the composition layer's values by `serverName` so editing a server does not drop its auth.
- Localize the settings page and App-tool prompts into Chinese, and add a per-server connectivity test ("测试连接") that performs a real MCP handshake through the Host.

## 0.1.0

- Add stdio and Streamable HTTP MCP Server connections.
- Register model-visible MCP tools in DeepSeek Harness.
- Render MCP Apps UI resources in sandboxed Harness Web tool cards.
- Proxy App-visible tools and resources through a loopback-only Host channel.
