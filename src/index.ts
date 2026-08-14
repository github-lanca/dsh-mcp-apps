import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-client-connection'
import { ConfigSchema, type Config as PluginConfig } from './config.ts'
import { createMcpClient } from './connection.ts'
import { discoverTools, type McpClientLike } from './protocol.ts'
import { createToolDefinitions, type ToolCallingClient } from './tools.ts'
import { createRpcHandler } from './rpc.ts'

export type Config = PluginConfig
export type { StdioConfig, StreamableHttpConfig } from './config.ts'
export { ConfigSchema } from './config.ts'
export { publicToolName } from './protocol.ts'

export const name = 'mcp-apps'
export const inject = ['tools', 'connection']
export const Config = ConfigSchema

export interface ConnectedMcpClient {
  client: McpClientLike & ToolCallingClient
  close(): void | Promise<void>
}

export type ClientFactory = (config: PluginConfig) => Promise<ConnectedMcpClient>

export async function applyWithClientFactory(
  ctx: Context,
  config: PluginConfig,
  factory: ClientFactory,
): Promise<void> {
  let connected: ConnectedMcpClient
  try {
    connected = await factory(config)
  } catch (error) {
    if (config.failOnStartupError) throw error
    ctx.logger.error(`mcp-apps(${config.serverName}): startup failed: ${String(error)}`)
    return
  }

  ctx.effect(() => () => connected.close(), `mcp-apps(${config.serverName}): connection`)
  const descriptors = await discoverTools(connected.client, config.serverName)
  const definitions = createToolDefinitions(
    connected.client,
    descriptors,
    config.serverName,
    config.toolCallTimeoutMs,
  )
  ctx.effect(
    () => ctx.connection.rpc.handle(
      '/mcp-apps',
      createRpcHandler(connected.client, descriptors, config.toolCallTimeoutMs),
      { authority: 'loopback' },
    ),
    `mcp-apps(${config.serverName}): client RPC`,
  )
  for (const definition of definitions) {
    ctx.effect(() => ctx.tools.register(definition), `mcp-apps(${config.serverName}): ${definition.name}`)
  }
}

export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  await applyWithClientFactory(ctx, config, createMcpClient)
}
