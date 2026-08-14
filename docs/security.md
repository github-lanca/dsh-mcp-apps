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
- RPC payloads are schema-validated and the channel accepts loopback authorities only.
- MCP URL, process command, headers, environment, and credentials remain Host-only.
- The durable result metadata contains App identity and the Server-returned JSON result, never connection configuration.

## Deliberately unsupported

External-link opening, downloads, sampling, prompts, and model-context mutation are not advertised. A View cannot access a capability that the Host does not declare through `AppBridge` initialization.
