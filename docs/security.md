# Security

## Trust boundaries

- MCP Server output is untrusted network or child-process data.
- App HTML is untrusted executable content.
- Model-generated tool arguments are untrusted input.
- Browser-to-Host RPC payloads are untrusted JSON.

## Controls

- The iframe omits `allow-same-origin` and allows only scripts, forms, and downloads at the sandbox layer.
- Resource CSP defaults to no network, no nested frames, no base URI, and no form submission. Declared domains selectively widen the matching directive.
- Browser permissions are granted only when requested in MCP resource metadata.
- App tool calls are restricted to tools advertised by the same Server with App visibility.
- RPC payloads are schema-validated and the channel is registered through Connection's loopback-scoped surface.
- The settings page can edit, add, and remove MCP servers, but `headers`/`env` are declared `role('secret')`: their values never ride a wire read (redaction), and the browser sees a write-only input. The stdio process command stays Host-only. The Host re-merges the composition layer's `headers`/`env` by `serverName`, so editing a server does not silently drop its auth.
- The durable result metadata contains App identity and the Server-returned JSON result, never connection configuration.

## Deliberately unsupported

External-link opening, downloads, sampling, prompts, and model-context mutation are not advertised. A View cannot access a capability that the Host does not declare through `AppBridge` initialization.
