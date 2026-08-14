# DeepSeek Harness MCP Apps Host Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or execute the tasks inline with test-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Cordis plugin that connects one MCP server, registers its tools in DeepSeek Harness, and renders tools linked to MCP Apps resources as sandboxed interactive views in the Harness Web conversation.

**Architecture:** The Host half owns the MCP `Client`, transport, tool discovery, tool execution, resource reads, and a loopback-protected Connection RPC channel. Successful tool results project MCP Apps metadata into durable Harness tool-result `meta`. The Client half asks the Host for the UI-enabled tool names, registers keyed `tool.call.toolview` renderers, fetches the linked HTML through Host RPC, and uses the official `AppBridge` plus a sandbox proxy iframe to connect each View back to its original MCP server.

**Tech Stack:** TypeScript, Cordis, DeepSeek Harness public plugin APIs, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, React 18, Vitest, Testing Library, tsdown.

## Global Constraints

- One plugin instance connects exactly one MCP server over `stdio` or `streamable-http`.
- MCP Apps stable extension id is `io.modelcontextprotocol/ui`; supported MIME type is `text/html;profile=mcp-app`.
- The Host owns all MCP traffic; the browser never connects directly to the third-party MCP endpoint.
- Existing text-only MCP tools continue to work without an App UI.
- App HTML runs only in a sandboxed iframe; links, downloads, tool calls, and model-context updates cross audited bridge handlers.
- Tool registrations, RPC routes, MCP transports, client slots, message listeners, and object URLs are disposed with their Cordis fibers.
- No credentials are logged, returned to the browser, persisted in tool-result metadata, or committed.
- Every production behavior begins with a failing test and follows red-green-refactor.

---

### Task 1: Package shell and public configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsdown.config.ts`
- Create: `vitest.config.ts`
- Create: `src/config.ts`
- Test: `tests/config.spec.ts`

**Interfaces:**
- Produces `Config`, `StdioConfig`, `StreamableHttpConfig`, and `ConfigSchema`.
- `serverName` matches `[A-Za-z0-9_-]{1,32}`; transport configuration matches Harness MCP client conventions.

- [ ] Write a failing test that accepts valid stdio/HTTP configuration and rejects duplicate/invalid transport fields.
- [ ] Run `npm test -- tests/config.spec.ts` and verify failure because `src/config.ts` does not exist.
- [ ] Implement the minimal discriminated configuration schema.
- [ ] Re-run the focused test and verify it passes.
- [ ] Commit the package shell and configuration.

### Task 2: MCP Apps discovery and metadata projection

**Files:**
- Create: `src/protocol.ts`
- Test: `tests/protocol.spec.ts`

**Interfaces:**
- Produces `discoverTools(client, serverName)`, `readAppResource(client, uri)`, `appPresentationMeta(tool, value)`, and JSON-safe `AppToolDescriptor` / `AppResourcePayload` types.
- Uses `getToolUiResourceUri`, `RESOURCE_MIME_TYPE`, and visibility helpers from `@modelcontextprotocol/ext-apps/app-bridge`.

- [ ] Write failing tests for nested and legacy UI metadata, model/app visibility, pagination, invalid `ui://` URIs, MIME rejection, text/blob HTML, content-level CSP precedence, and listing-level fallback.
- [ ] Run the focused protocol test and verify expected missing-export failures.
- [ ] Implement discovery and resource validation with no transport or Cordis dependencies.
- [ ] Re-run the focused tests and refactor only while green.
- [ ] Commit protocol discovery.

### Task 3: Host MCP connection and native Harness tools

**Files:**
- Create: `src/connection.ts`
- Create: `src/tools.ts`
- Create: `src/index.ts`
- Test: `tests/tools.spec.ts`
- Test: `tests/plugin.spec.ts`

**Interfaces:**
- Produces one Cordis plugin entry `apply(ctx, config)` and deterministic public names `mcp__<serverName>__<rawName>`.
- Each successful canonical value is `{ content, structuredContent? }`; `output.presentationMeta` adds `{ mcpApp: { serverName, rawToolName, resourceUri } }` only for UI-enabled tools.

- [ ] Write a failing tool-registration test proving public schemas, raw wire names, app-only filtering, result preservation, error mapping, and durable presentation metadata.
- [ ] Run it and verify failure because the tool bridge is absent.
- [ ] Implement the minimal tool bridge and make the test green.
- [ ] Write a failing lifecycle test for connection, initial discovery, namespace conflict, and disposal.
- [ ] Implement the plugin lifecycle and transports, then run both tests green.
- [ ] Commit Host connection and tools.

### Task 4: Loopback-protected Host RPC for MCP App Views

**Files:**
- Create: `src/rpc.ts`
- Test: `tests/rpc.spec.ts`

**Interfaces:**
- Registers channel `/mcp-apps` through `ctx.connection.rpc.handle(..., { authority: 'loopback' })`.
- Endpoints: `tools/list-ui`, `resources/read`, `tools/call`, `tools/list`, `resources/list`, `prompts/list`, `prompts/get`, and `ping`.
- All handlers return Harness `RpcResult`; payloads are validated before reaching the SDK client.

- [ ] Write failing endpoint tests for discovery, resource reads, same-server tool calls, abort propagation, malformed payloads, unknown endpoints, and cleanup.
- [ ] Run the focused test and verify failure because the RPC router is absent.
- [ ] Implement the smallest endpoint router backed by the existing Host MCP client.
- [ ] Re-run tests and refactor the validation helpers while green.
- [ ] Commit the RPC bridge.

### Task 5: Sandboxed MCP Apps Client renderer

**Files:**
- Create: `src/client/index.ts`
- Create: `src/client/McpAppToolView.tsx`
- Create: `src/client/bridge.ts`
- Create: `src/client/sandbox.ts`
- Create: `src/client/mcp-apps.css`
- Create: `src/client/sandbox.html`
- Test: `tests/client-plugin.client.spec.tsx`
- Test: `tests/app-view.client.spec.tsx`

**Interfaces:**
- Client `apply(ctx)` injects `connection` and `slots`, calls `/mcp-apps/tools/list-ui`, and registers one keyed `tool.call.toolview` entry per discovered public tool name.
- Settled call metadata identifies the resource; `McpAppToolView` reads the call arguments and canonical result, loads the sandbox proxy, then sends input/result through official `AppBridge` notifications.
- App-originated server methods are forwarded only through `/mcp-apps`; `openLink` uses a safe user gesture and `requestDisplayMode` is bounded to inline/fullscreen.

- [ ] Write a failing client-plugin test for dynamic keyed registration and fiber disposal.
- [ ] Implement discovery and registration, then verify it passes.
- [ ] Write a failing View test for loading/error/ready states, sandbox attributes, CSP/permissions, handshake order, input/result delivery, resize limits, teardown, and app-to-server calls.
- [ ] Implement the View using `AppBridge(null, ...)` with explicit Host RPC handlers and a vendored build of the official sandbox proxy page.
- [ ] Re-run both client tests and refactor while green.
- [ ] Commit the browser renderer.

### Task 6: Build, Harness configuration, and reference MCP Server integration

**Files:**
- Create: `examples/cordis.patch.yml`
- Create: `examples/.env.example`
- Create: `examples/README.md`
- Create: `tests/fixtures/mcp-app-server.ts`
- Test: `tests/integration.spec.ts`

**Interfaces:**
- Example patch mounts this package once with either stdio or Streamable HTTP settings.
- The fixture exposes one text tool and one UI tool; the external validation profile can point to the user-provided VibeFun MCP endpoint without changing plugin code.

- [ ] Write a failing integration test that boots a real Cordis context and fixture Server, discovers both tools, calls the UI tool, reads its `ui://` HTML, and tears down cleanly.
- [ ] Run it and verify failure at the first missing integration seam.
- [ ] Implement the example server/configuration and make integration green.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build`.
- [ ] Start Harness with the example patch, connect the provided VibeFun MCP Server, and capture the successful configuration/tool/UI evidence.
- [ ] Commit the verified integration.

### Task 7: User documentation and compatibility contract

**Files:**
- Create: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/security.md`
- Create: `CHANGELOG.md`

**Interfaces:**
- Documents install, build, configuration, stdio/HTTP examples, protocol coverage, Harness version, SDK versions, security boundaries, graceful degradation, and known limitations.

- [ ] Write documentation from commands and evidence already verified in Task 6.
- [ ] Add a documentation smoke test that checks every referenced example path and npm script exists.
- [ ] Run the smoke test and full verification suite.
- [ ] Commit the release-ready documentation.

### Task 8: Video production handoff

**Files:**
- Create under `/Users/wyang14/github/ai-video/20260814-deepseek-harness-mcp-apps/`: research notes, narration, storyboard, HyperFrames composition, renders, covers, and publishing copy.

**Interfaces:**
- Uses only verified commands, screenshots, and limitations from Tasks 1–7.
- Design preset is `code-editorial`; narration is TTS; final output is 1080p plus 4K, five cover ratios, YouTube/Bilibili copy, blog, and one social post.

- [ ] Turn the verified implementation into a Chinese narrative: why plugins exist → why MCP tools are insufficient for rich UI → Host/Client architecture → code walkthrough → configuration → live VibeFun demo → limitations.
- [ ] Generate TTS and timed SRT, then align frame durations and reveals to real cue times.
- [ ] Build and validate every HyperFrames scene with continuous motion and real transitions.
- [ ] Render 1080p first, then 4K; generate all covers and publishing materials.
- [ ] Run final code, visual, audio, and deliverable checks before claiming completion.

## Self-review

- Spec coverage: Host MCP tools, official MCP Apps negotiation, UI resources, sandboxing, bidirectional calls, Harness configuration, external Server validation, documentation, and video deliverables each have an owning task.
- Placeholder scan: the plan contains no deferred implementation placeholder; the external endpoint is intentionally supplied through runtime configuration.
- Type consistency: Host RPC payloads are JSON-only; durable tool-result metadata contains identity only; Client resource and tool operations reuse the same Host MCP connection.
