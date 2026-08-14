import { z } from 'zod'
import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { readAppResource, type AppToolDescriptor, type McpClientLike } from './protocol.ts'
import type { ToolCallingClient } from './tools.ts'

const readResourceInput = z.object({ uri: z.string().startsWith('ui://') }).strict()
const callToolInput = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
}).strict()

export type AppRpcClient = McpClientLike & ToolCallingClient

export function createRpcHandler(
  client: AppRpcClient,
  descriptors: readonly AppToolDescriptor[],
  toolCallTimeoutMs: number,
) {
  const tools = new Map(descriptors.map(tool => [tool.rawName, tool]))
  return async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
    try {
      switch (endpoint) {
        case 'tools/list-ui':
          return ok(descriptors
            .filter(tool => tool.resourceUri !== undefined && tool.modelVisible)
            .map(tool => ({
              publicName: tool.publicName,
              rawName: tool.rawName,
              resourceUri: tool.resourceUri!,
            })))
        case 'resources/read': {
          const input = readResourceInput.parse(payload)
          return ok(await readAppResource(client, input.uri))
        }
        case 'tools/call': {
          const input = callToolInput.parse(payload)
          const tool = tools.get(input.name)
          if (tool === undefined || !tool.appVisible) return badRequest(`Tool ${JSON.stringify(input.name)} is not app-visible`)
          return ok(await client.callTool(
            { name: input.name, arguments: input.arguments },
            { signal, timeout: toolCallTimeoutMs },
          ))
        }
        case 'tools/list':
          return ok({ tools: descriptors.filter(tool => tool.appVisible).map(tool => tool.raw) })
        case 'resources/list':
          return ok(await client.listResources())
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
