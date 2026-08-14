import { useEffect, useMemo, useRef, useState } from 'react'
import { buildAllowAttribute } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { UiToolRegistration } from './index.tsx'
import { connectViewBridge, type SettledAppCall } from './bridge.ts'

export interface McpAppToolViewProps extends ToolCallOwnerProps {
  tool: UiToolRegistration
  connection: ConnectionHandle
}

interface AppResource {
  uri: string
  html: string
  csp?: Record<string, unknown>
  permissions?: Record<string, Record<string, never>>
}

export function resolveSettledAppCall(block: ToolCallBlock, tool: UiToolRegistration): SettledAppCall | null {
  if (!('kind' in block) || block.call === null) return null
  const meta = block.meta
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const app = (meta as Record<string, unknown>).mcpApp
  if (typeof app !== 'object' || app === null || Array.isArray(app)) return null
  const identity = app as Record<string, unknown>
  if (identity.rawToolName !== tool.rawName || identity.resourceUri !== tool.resourceUri) return null
  const result = parseCallToolResult(identity.result)
  if (result === null) return null
  let args: unknown
  try {
    args = JSON.parse(block.call.argsRaw)
  } catch {
    return null
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
  return {
    arguments: args as Record<string, unknown>,
    result,
    resourceUri: tool.resourceUri,
  }
}

export function McpAppToolView({ tool, block, connection }: McpAppToolViewProps) {
  const call = useMemo(() => resolveSettledAppCall(block, tool), [block, tool])
  const [resource, setResource] = useState<AppResource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState(360)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    if (call === null) return
    const controller = new AbortController()
    void connection.rpc.call(
      '/mcp-apps',
      'resources/read',
      { uri: call.resourceUri },
      controller.signal,
    ).then((result) => {
      if (!result.ok) throw new Error(result.error.message)
      setResource(parseResource(result.value, call.resourceUri))
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => controller.abort()
  }, [call, connection])

  useEffect(() => {
    if (call === null || resource === null || iframeRef.current?.contentWindow === null) return
    const iframe = iframeRef.current
    if (iframe === null) return
    let disposed = false
    let dispose: (() => Promise<void>) | undefined
    void connectViewBridge(iframe, connection, call, nextHeight => {
      setHeight(Math.max(160, Math.min(800, Math.round(nextHeight))))
    }).then((nextDispose) => {
      if (disposed) void nextDispose()
      else dispose = nextDispose
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => {
      disposed = true
      if (dispose !== undefined) void dispose()
    }
  }, [call, connection, resource])

  if (call === null) {
    return <div style={CARD_STYLE} data-mcp-app-tool={tool.rawName}>Waiting for MCP App result…</div>
  }
  if (error !== null) {
    return <div style={{ ...CARD_STYLE, padding: 12, color: '#b42318' }} role="alert">{error}</div>
  }
  if (resource === null) {
    return <div style={CARD_STYLE} data-mcp-app-tool={tool.rawName}>Loading MCP App…</div>
  }

  return <div style={CARD_STYLE} data-mcp-app-tool={tool.rawName}>
    <div style={TITLE_STYLE}>{tool.rawName}</div>
    <iframe
      ref={iframeRef}
      title={`${tool.rawName} MCP App`}
      sandbox="allow-scripts allow-forms allow-downloads"
      allow={buildAllowAttribute(resource.permissions as never) || undefined}
      srcDoc={withContentSecurityPolicy(resource.html, resource.csp)}
      style={{ display: 'block', width: '100%', minHeight: 160, height, border: 0, background: 'transparent' }}
    />
  </div>
}

const CARD_STYLE = {
  overflow: 'hidden',
  width: '100%',
  border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
  borderRadius: 12,
  background: 'color-mix(in srgb, currentColor 3%, transparent)',
} as const

const TITLE_STYLE = {
  padding: '8px 12px',
  borderBottom: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
  font: '600 12px/1.4 system-ui, sans-serif',
  opacity: 0.72,
} as const

function parseCallToolResult(value: unknown): SettledAppCall['result'] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.content)) return null
  return result as SettledAppCall['result']
}

function parseResource(value: unknown, uri: string): AppResource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid MCP App resource response')
  const resource = value as Record<string, unknown>
  if (resource.uri !== uri || typeof resource.html !== 'string') throw new Error('Invalid MCP App resource response')
  return resource as unknown as AppResource
}

function withContentSecurityPolicy(html: string, csp: Record<string, unknown> | undefined): string {
  const domains = (key: string): string[] => {
    const value = csp?.[key]
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  }
  const resources = domains('resourceDomains')
  const directive = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resources.join(' ')}`.trim(),
    `style-src 'unsafe-inline' ${resources.join(' ')}`.trim(),
    `img-src data: blob: ${resources.join(' ')}`.trim(),
    `font-src data: ${resources.join(' ')}`.trim(),
    `media-src data: blob: ${resources.join(' ')}`.trim(),
    `connect-src ${domains('connectDomains').join(' ') || "'none'"}`,
    `frame-src ${domains('frameDomains').join(' ') || "'none'"}`,
    `base-uri ${domains('baseUriDomains').join(' ') || "'none'"}`,
    "form-action 'none'",
  ].join('; ')
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(directive)}">`
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${meta}`)
    : `${meta}${html}`
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}
