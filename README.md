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

## Install DeepSeek Harness

DeepSeek Harness currently requires Node.js `^22.19.0` or `>=24.0.0`. Its profile plugin manager also invokes `pnpm`; install the version used by the current DSH release:

```sh
npm install --global pnpm@11.7.0
```

Then start the Web profile without a global DSH installation:

```sh
npx @deepseek-ai/dsh web
```

The Web UI is served at <http://127.0.0.1:3080> by default. The first run initializes the `web` profile under `~/.dsh/profiles/web` (or `$DSH_HOME/profiles/web` when `DSH_HOME` is set).

## Install the plugin

Install the published package into the DSH Web profile:

```sh
npx @deepseek-ai/dsh plugin --profile web add @sugarforever/dsh-mcp-apps
```

For local development, install this checkout instead:

```sh
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-mcp-apps
```

You can also install a tarball downloaded from a GitHub Release:

```sh
npx @deepseek-ai/dsh plugin --profile web add ./sugarforever-dsh-mcp-apps-0.1.2.tgz
```

The package is a DSH bundle. Installing it also applies its bundled `cordis.patch.yml`, which mounts the public VibeFun MCP Apps server at `https://vibefun.app/api/mcp` by default.

To connect a different server, edit the installed profile patch at `~/.dsh/profiles/web/cordis.patch.yml` and replace the generated instance configuration. The relevant entry is:

```yaml
- insert:
    - id: mcp-apps-vibefun
      name: '@sugarforever/dsh-mcp-apps'
      config:
        serverName: vibefun
        transport: streamable-http
        url: https://vibefun.app/api/mcp
        failOnStartupError: true
```

Start or restart DSH and open <http://127.0.0.1:3080>:

```sh
npx @deepseek-ai/dsh web
```

To remove the package dependency:

```sh
npx @deepseek-ai/dsh plugin --profile web remove @sugarforever/dsh-mcp-apps
```

The plugin manager also removes the bundle patch contributed by the package.

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

## Publish

The repository includes `.github/workflows/publish.yml`. Publishing a GitHub Release runs the complete release gate, creates an npm tarball, uploads it as a workflow artifact and GitHub Release asset, and publishes the same tarball to npm. Reruns are safe: when that exact npm version already exists, the workflow skips the immutable npm publication and still completes the GitHub artifacts.

The workflow uses npm Trusted Publishing with GitHub OIDC, so it does not require an `NPM_TOKEN` secret.

### One-time npm setup

1. If `@sugarforever/dsh-mcp-apps` does not exist on npm yet, publish the first version locally:

   ```sh
   npm login
   npm ci
   npm test
   npm run typecheck
   npm run build
   npm pack --dry-run
   npm publish --access public
   ```

2. On npmjs.com, open the package's **Settings → Trusted Publisher**, choose **GitHub Actions**, and configure:

   - Organization or user: `sugarforever`
   - Repository: `dsh-mcp-apps`
   - Workflow filename: `publish.yml`
   - Allowed action: `npm publish`

3. Do not add an environment name unless the workflow is also updated to use that exact GitHub environment.

### Release a new version

Update and commit the package version, then push the matching tag:

```sh
npm version patch
git push origin main --follow-tags
```

Create and publish a GitHub Release for that tag. For example, package version `0.1.1` must use tag `v0.1.1`. Publishing the Release triggers the workflow; a mismatched tag fails before npm publication.

Before creating a Release, the same checks can be run locally:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

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
