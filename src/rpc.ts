import { z } from 'zod'
import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { readAppResource, type AppToolDescriptor, type McpClientLike } from './protocol.ts'
import type { McpServerConfig } from './config.ts'
import type { ToolCallingClient } from './tools.ts'

const callToolInput = z.object({
  serverName: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
}).strict()

const readResourceInput = z.object({
  serverName: z.string().min(1),
  uri: z.string().startsWith('ui://'),
}).strict()

const serverInput = z.object({ serverName: z.string().min(1) }).strict()

const testInput = z.object({
  serverName: z.string().min(1),
  transport: z.union([z.literal('stdio'), z.literal('streamable-http')]),
  url: z.string().default(''),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  cwd: z.string().default(''),
}).strict()

/** 一次性测试连接的结果：可达与否及其诊断细节。 */
export interface McpTestResult {
  reachable: boolean
  detail?: string
}

/**
 * 一个已连接的 MCP Server 运行时：进程内的客户端连接 + 其工具描述符。
 */
export interface McpServerRuntime {
  serverName: string
  client: McpClientLike & ToolCallingClient
  descriptors: readonly AppToolDescriptor[]
}

/** createRpcHandler 的附加依赖：组成层默认服务器（用于按 serverName 合并 headers/env）和一次性连接测试。 */
export interface McpRpcOptions {
  baseServers: readonly McpServerConfig[]
  testConnection: (config: McpServerConfig) => Promise<void>
}

export function createRpcHandler(
  runtimes: readonly McpServerRuntime[],
  toolCallTimeoutMs: number,
  options?: McpRpcOptions,
) {
  const byServer = new Map(runtimes.map(runtime => [runtime.serverName, runtime]))
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
    try {
      switch (endpoint) {
        // 聚合所有服务器的 UI 工具；每个条目带上 serverName，客户端据此把 App 调用路由回对应 Server。
        case 'tools/list-ui':
          return ok(runtimes.flatMap(runtime => runtime.descriptors
            .filter(tool => tool.resourceUri !== undefined && tool.modelVisible)
            .map(tool => ({
              serverName: runtime.serverName,
              publicName: tool.publicName,
              rawName: tool.rawName,
              resourceUri: tool.resourceUri!,
            }))))
        case 'resources/read': {
          const input = readResourceInput.parse(payload)
          const runtime = requireServer(byServer, input.serverName)
          return ok(await readAppResource(runtime.client, input.uri))
        }
        case 'tools/call': {
          const input = callToolInput.parse(payload)
          const runtime = requireServer(byServer, input.serverName)
          const tool = runtime.descriptors.find(candidate => candidate.rawName === input.name)
          if (tool === undefined || !tool.appVisible) return badRequest(`Tool ${JSON.stringify(input.name)} is not app-visible`)
          return ok(await runtime.client.callTool(
            { name: input.name, arguments: input.arguments },
            { signal, timeout: toolCallTimeoutMs },
          ))
        }
        case 'tools/list': {
          const input = serverInput.parse(payload)
          const runtime = requireServer(byServer, input.serverName)
          return ok({ tools: runtime.descriptors.filter(tool => tool.appVisible).map(tool => tool.raw) })
        }
        case 'resources/list': {
          const input = serverInput.parse(payload)
          const runtime = requireServer(byServer, input.serverName)
          return ok(await runtime.client.listResources())
        }
        case 'test': {
          if (options?.testConnection === undefined) return badRequest('连接测试不可用')
          const input = testInput.parse(payload)
          const merged = mergeBaseServers(options?.baseServers ?? [], input)
          try {
            await options.testConnection(merged)
            return ok({ reachable: true } satisfies McpTestResult)
          } catch (error) {
            // 可达性失败也作为正常响应返回，UI 据此显示“不可达 + 原因”。
            return ok({ reachable: false, detail: error instanceof Error ? error.message : String(error) } satisfies McpTestResult)
          }
        }
        case 'ping':
          return ok({})
        default:
          return badRequest(`Unknown MCP Apps endpoint ${JSON.stringify(endpoint)}`)
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error))
    }
  }
}

function requireServer(
  byServer: Map<string, McpServerRuntime>,
  serverName: string,
): McpServerRuntime {
  const runtime = byServer.get(serverName)
  if (runtime === undefined) throw new Error(`Unknown MCP server ${JSON.stringify(serverName)}`)
  return runtime
}

/** 用输入配置做一次连接测试时，按 serverName 把组成层的 headers/env 合并回去，避免测试丢失鉴权。 */
function mergeBaseServers(baseServers: readonly McpServerConfig[], input: {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  url: string
  command: string
  args: string[]
  cwd: string
}): McpServerConfig {
  const base = baseServers.find(server => server.serverName === input.serverName)
  return {
    serverName: input.serverName,
    transport: input.transport,
    url: input.transport === 'streamable-http' ? input.url : '',
    command: input.transport === 'stdio' ? input.command : '',
    args: input.transport === 'stdio' ? input.args : [],
    cwd: input.transport === 'stdio' ? input.cwd : '',
    headers: base?.headers ?? {},
    env: base?.env ?? {},
  }
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value } as RpcResult<T>
}

function badRequest(message: string): RpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'bad-request',
      message,
      details: { issues: [] },
    },
  } as RpcResult<never>
}
