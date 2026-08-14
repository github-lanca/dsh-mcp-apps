# DeepSeek Harness MCP Apps

`@sugarforever/dsh-mcp-apps` is a dual-face Cordis plugin that makes DeepSeek Harness an MCP Apps host.

The Host half connects to one MCP Server, registers its model-visible tools on `ctx.tools`, and owns all MCP network or stdio traffic. The Web Client half renders tools carrying `_meta.ui.resourceUri` as sandboxed interactive Apps inside the Harness conversation.

## What it supports

- MCP Apps extension negotiation: `io.modelcontextprotocol/ui`
- `text/html;profile=mcp-app` UI resources
- Modern `_meta.ui.resourceUri` and legacy `_meta["ui/resourceUri"]`
- stdio and Streamable HTTP MCP transports
- Model-visible, App-visible, and App-only tools
- Original `CallToolResult` delivery to the View, including `structuredContent`
- View-to-Server `tools/call`, `resources/list`, and `resources/read`
- Resource CSP metadata and iframe Permission Policy requests
- Cordis lifecycle disposal for tools, connections, RPC routes, Slots, and App bridges

Plain MCP tools remain plain Harness tools. An MCP Server does not need to provide a UI for every tool.

## Install

Until the package is published, install it from this checkout in the configuration project that resolves your Harness plugins:

```sh
npm install /absolute/path/to/dsh-mcp-apps
```

After publication:

```sh
npm install @sugarforever/dsh-mcp-apps
```

## Configure a stdio Server

Create `mcp-apps.cordis.yml`:

```yaml
- insert:
    - id: mcp-apps-vibefun
      name: '@sugarforever/dsh-mcp-apps'
      config:
        serverName: vibefun
        transport: stdio
        command: node
        args: ['/absolute/path/to/your-mcp-server.js']
        env:
          VIBEFUN_API_KEY: !!js process.env.VIBEFUN_API_KEY
        failOnStartupError: true
```

Run the Harness Web profile with the overlay:

```sh
dsh web --patch "$PWD/mcp-apps.cordis.yml"
```

## Configure a Streamable HTTP Server

```yaml
- insert:
    - id: mcp-apps-vibefun
      name: '@sugarforever/dsh-mcp-apps'
      config:
        serverName: vibefun
        transport: streamable-http
        url: http://127.0.0.1:3000/mcp
        headers:
          Authorization: !!js '`Bearer ${process.env.VIBEFUN_MCP_TOKEN}`'
        failOnStartupError: true
```

The browser never receives the URL, command, headers, environment, or credentials. Its package-private RPC channel is loopback-only.

## Develop

```sh
npm install
npm test
npm run typecheck
npm run build
```

The integration test starts a real stdio MCP Apps Server and verifies discovery, tool execution, structured output, resource reading, and teardown.

## Architecture

```text
Model ── native Harness tool ── Host MCP Client ── MCP Server
                                  │                    │
                                  │ loopback RPC       │ ui:// resource
                                  ▼                    │
Harness Web tool card ── AppBridge ── sandboxed iframe View
```

See [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).

## Current limitations

- One plugin instance owns one MCP Server. Mount multiple instances for multiple Servers.
- UI tool discovery occurs at Client plugin activation. A Server changing its UI tool list requires a Client refresh or plugin reload.
- Prompts, sampling, downloads, external-link opening, and model-context updates are not exposed to Apps yet.
- App HTML is loaded with `srcdoc`; Apps should ship self-contained HTML or declare every remote origin in resource CSP metadata.
- The current iframe path targets the Web client. Headless and ACP entry points still receive the tools but have no embedded App surface.

## Protocol references

- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [Official MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

## License

MIT
