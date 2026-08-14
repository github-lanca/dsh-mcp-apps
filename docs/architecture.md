# Architecture

## Why this is a dual-face plugin

DeepSeek Harness executes tools on the Host, while interactive conversation UI runs in the browser Client. Keeping the MCP `Client` on the Host is required for stdio Servers, avoids browser CORS assumptions, and prevents credentials from crossing into the page.

The Host and Client communicate through the existing Harness Connection service on a dedicated `/mcp-apps` RPC channel. The channel is registered with `authority: loopback`.

## Host lifecycle

1. Construct an official MCP SDK `Client` advertising `io.modelcontextprotocol/ui` and `text/html;profile=mcp-app`.
2. Connect by stdio or Streamable HTTP.
3. Drain `tools/list` pagination.
4. Register model-visible tools as `mcp__<serverName>__<rawName>`.
5. Project MCP App identity and the JSON-safe original `CallToolResult` into Harness presentation metadata.
6. Serve UI discovery, resource reads, and App-visible tool calls through `/mcp-apps`.
7. Dispose the tool registrations, RPC channel, and MCP connection with the Cordis fiber.

## Client lifecycle

1. Ask `tools/list-ui` for public tool names linked to Apps.
2. Register one keyed `tool.call.toolview` entry for each name.
3. After the call settles, verify its durable MCP App metadata.
4. Read the `ui://` HTML from the Host.
5. Apply declared CSP and Permission Policy to a sandboxed `srcdoc` iframe.
6. Connect the official `AppBridge` through `PostMessageTransport`.
7. Send tool input followed by the original result after View initialization.
8. Proxy App-visible calls and resources to the original Server connection.

## Graceful degradation

Tools without `ui.resourceUri` use the ordinary Harness tool card. Headless clients receive the same native tools and model-facing content without trying to render an App.
