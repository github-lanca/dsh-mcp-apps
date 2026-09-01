import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import { McpAppsNamespaceSchema } from './config.ts'
import { ConfigSchema, type Config as PluginConfig, type McpServerConfig } from './config.ts'
import { createMcpClient } from './connection.ts'
import { discoverTools, type McpClientLike } from './protocol.ts'
import { createToolDefinitions, type ToolCallingClient } from './tools.ts'
import { createRpcHandler, type McpServerRuntime } from './rpc.ts'

export type Config = PluginConfig
export type { McpServerConfig } from './config.ts'
export { ConfigSchema, McpAppsNamespaceSchema } from './config.ts'
export { publicToolName } from './protocol.ts'

export const name = 'mcp-apps'
export const inject = ['tools', 'connection', 'settings']
export const Config = ConfigSchema

/** 设置命名空间，承载可编辑/可新增的 MCP 服务器列表。 */
const SETTINGS_NAMESPACE = 'mcp-apps'

export interface ConnectedMcpClient {
  client: McpClientLike & ToolCallingClient
  close(): void | Promise<void>
}

export type ClientFactory = (config: McpServerConfig) => Promise<ConnectedMcpClient>

export async function applyWithClientFactory(
  ctx: Context,
  config: PluginConfig,
  factory: ClientFactory,
): Promise<void> {
  // 读取设置命名空间解析后的服务器列表（组成层默认值 + 用户层叠加）。
  const servers = resolveServers(ctx, config)

  const runtimes: McpServerRuntime[] = []
  for (const server of servers) {
    const started = await startServer(ctx, config, server, factory)
    if (started !== undefined) runtimes.push(started)
  }

  for (const runtime of runtimes) {
    const definitions = createToolDefinitions(
      runtime.client,
      runtime.descriptors,
      runtime.serverName,
      config.toolCallTimeoutMs,
    )
    for (const definition of definitions) {
      ctx.effect(() => ctx.tools.register(definition), `mcp-apps(${runtime.serverName}): ${definition.name}`)
    }
  }

  // 单一 /mcp-apps 通道，跨所有已连接 Server 路由（按 serverName 区分）。
  ctx.effect(
    () => ctx.connection.rpc.handle(
      '/mcp-apps',
      createRpcHandler(runtimes, config.toolCallTimeoutMs, {
        baseServers: config.servers,
        testConnection: testServerConnection,
      }),
    ),
    'mcp-apps: client RPC',
  )
}

const TEST_CONNECT_TIMEOUT_MS = 10_000

/**
 * 一次性验证一个服务器配置是否可达：复用 createMcpClient 建立 MCP 连接，
 * 成功即代表可达；随后立即关闭连接。包一层超时，避免死等不可达主机。
 */
async function testServerConnection(server: McpServerConfig): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const connected = await Promise.race([
    createMcpClient(server),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('连接超时')), TEST_CONNECT_TIMEOUT_MS)
    }),
  ])
  if (timer !== undefined) clearTimeout(timer)
  await Promise.resolve(connected.close()).catch(() => undefined)
}

async function startServer(
  ctx: Context,
  config: PluginConfig,
  server: McpServerConfig,
  factory: ClientFactory,
): Promise<McpServerRuntime | undefined> {
  try {
    const connected = await factory(server)
    const descriptors = await discoverTools(connected.client, server.serverName)
    ctx.effect(() => () => connected.close(), `mcp-apps(${server.serverName}): connection`)
    return { serverName: server.serverName, client: connected.client, descriptors }
  } catch (error) {
    if (config.failOnStartupError) throw error
    ctx.logger.error(`mcp-apps(${server.serverName}): startup failed: ${String(error)}`)
    return undefined
  }
}

/**
 * 注册 `mcp-apps` 设置命名空间并返回当前生效的服务器列表。
 * `base` 用组成层配置（cordis.patch.yml）作为默认值，用户的增删改落在设置文档的用户层。
 */
function resolveServers(ctx: Context, config: PluginConfig): McpServerConfig[] {
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, McpAppsNamespaceSchema, {
    base: { servers: config.servers },
    applies: 'restart',
  })
  const servers = scope.get().servers
  // 浏览器端设置页只能拿到脱敏后的服务器列表（headers/env 被 redact）。
  // 这里按 serverName 把组成层的 headers/env 合并回去，避免用户在 UI 里保存后丢失已有鉴权。
  const baseByServer = new Map(config.servers.map(server => [server.serverName, server]))
  return servers.map(server => {
    const base = baseByServer.get(server.serverName)
    if (base === undefined) return server
    return {
      ...server,
      headers: { ...base.headers, ...server.headers },
      env: { ...base.env, ...server.env },
    }
  })
}

export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  await applyWithClientFactory(ctx, config, createMcpClient)
}
