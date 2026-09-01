import { type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { McpServerConfig } from '../config.ts'
import { McpAppToolView } from './McpAppToolView.tsx'
import { McpAppsSettingsController, McpAppsSettingsSection } from './McpAppsSettingsSection.tsx'

export const inject = ['connection', 'slots', 'settingsScope']

interface UiToolRegistration {
  serverName: string
  publicName: string
  rawName: string
  resourceUri: string
}

export async function apply(ctx: Context): Promise<void> {
  // Host 与浏览器各自声明 `ctx.connection`，两者在不同平台执行，因此做一次类型收敛。
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

  // 设置页独立“MCP Apps”段：绑定设置命名空间，提供可编辑/新增/删除服务器 + 保存 + 连接测试。
  const scope = ctx.settingsScope.bind<{ servers: McpServerConfig[] }>({ namespace: 'mcp-apps' })
  const controller = new McpAppsSettingsController(scope, async (server) => {
    const result = await connection.rpc.call('/mcp-apps', 'test', server)
    if (!result.ok) return { reachable: false, detail: result.error.message }
    return result.value as { reachable: boolean; detail?: string }
  })
  ctx.effect(
    () => ctx.slots.inject('settings.section', () => ctx.slots.register(
      { name: 'settings.section', id: 'mcp-apps', order: 20, label: () => 'MCP 服务器', inject: () => controller.face() },
      McpAppsSettingsSection,
    )),
    'mcp-apps: settings section',
  )
}

function parseUiTool(value: unknown): UiToolRegistration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('mcp-apps: invalid UI tool registration')
  }
  const item = value as Record<string, unknown>
  if (
    typeof item.serverName !== 'string'
    || typeof item.publicName !== 'string'
    || typeof item.rawName !== 'string'
    || typeof item.resourceUri !== 'string'
    || !item.resourceUri.startsWith('ui://')
  ) {
    throw new Error('mcp-apps: invalid UI tool registration')
  }
  return {
    serverName: item.serverName,
    publicName: item.publicName,
    rawName: item.rawName,
    resourceUri: item.resourceUri,
  }
}

export type { UiToolRegistration }
