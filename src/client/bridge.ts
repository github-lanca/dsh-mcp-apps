import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { CallToolResult, ListResourcesResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'

export interface SettledAppCall {
  arguments: Record<string, unknown>
  result: CallToolResult
  resourceUri: string
  /** 该 App 所属的 MCP Server，用于把调用路由回正确的 Server。 */
  serverName: string
}

export async function connectViewBridge(
  iframe: HTMLIFrameElement,
  connection: ConnectionHandle,
  call: SettledAppCall,
  onHeight: (height: number) => void,
): Promise<() => Promise<void>> {
  const contentWindow = iframe.contentWindow
  if (contentWindow === null) throw new Error('MCP App iframe is unavailable')
  const bridge = new AppBridge(
    null,
    { name: 'DeepSeek Harness', version: '0.1.0' },
    { serverTools: {}, serverResources: {} },
  )
  bridge.oncalltool = async (params, extra) => rpcValue<CallToolResult>(connection, 'tools/call', {
    serverName: call.serverName,
    name: params.name,
    arguments: params.arguments ?? {},
  }, extra.signal)
  bridge.onlistresources = async (_params, extra) =>
    rpcValue<ListResourcesResult>(connection, 'resources/list', { serverName: call.serverName }, extra.signal)
  bridge.onreadresource = async (params, extra) =>
    rpcValue<ReadResourceResult>(connection, 'resources/read', { serverName: call.serverName, uri: params.uri }, extra.signal)
  bridge.onsizechange = params => {
    if (typeof params.height === 'number' && Number.isFinite(params.height)) onHeight(params.height)
  }
  bridge.oninitialized = () => {
    void bridge.sendToolInput({ arguments: call.arguments })
      .then(() => bridge.sendToolResult(call.result))
  }
  await bridge.connect(new PostMessageTransport(contentWindow, contentWindow))
  return async () => {
    await bridge.teardownResource({}).catch(() => undefined)
  }
}

async function rpcValue<T>(
  connection: ConnectionHandle,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const result = await connection.rpc.call('/mcp-apps', endpoint, payload, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value as T
}
