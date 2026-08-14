import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { McpAppToolView } from './McpAppToolView.tsx'

export const inject = ['connection', 'slots']

interface UiToolRegistration {
  publicName: string
  rawName: string
  resourceUri: string
}

export async function apply(ctx: ClientContext): Promise<void> {
  // Host and browser declarations both merge `ctx.connection` in one source
  // package, while the two bundles execute on separate platforms.
  const connection = (ctx as unknown as { connection: ConnectionHandle }).connection
  const result = await connection.rpc.call('/mcp-apps', 'tools/list-ui', null)
  if (!result.ok) throw new Error(result.error.message)
  if (!Array.isArray(result.value)) throw new Error('mcp-apps: Host returned an invalid UI tool list')
  for (const candidate of result.value) {
    const tool = parseUiTool(candidate)
    ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: tool.publicName },
      props => <McpAppToolView {...props} tool={tool} connection={connection} />,
    )), `mcp-apps: ${tool.publicName} view`)
  }
}

function parseUiTool(value: unknown): UiToolRegistration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('mcp-apps: invalid UI tool registration')
  }
  const item = value as Record<string, unknown>
  if (
    typeof item.publicName !== 'string'
    || typeof item.rawName !== 'string'
    || typeof item.resourceUri !== 'string'
    || !item.resourceUri.startsWith('ui://')
  ) {
    throw new Error('mcp-apps: invalid UI tool registration')
  }
  return {
    publicName: item.publicName,
    rawName: item.rawName,
    resourceUri: item.resourceUri,
  }
}

export type { UiToolRegistration }
