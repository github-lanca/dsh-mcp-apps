import { describe, expect, it, vi } from 'vitest'
import { createRpcHandler, type McpServerRuntime } from '../src/rpc.ts'
import type { AppToolDescriptor, McpClientLike } from '../src/protocol.ts'
import type { ToolCallingClient } from '../src/tools.ts'

const descriptors: AppToolDescriptor[] = [
  {
    rawName: 'chart',
    publicName: 'mcp__vibefun__chart',
    inputSchema: { type: 'object' },
    resourceUri: 'ui://vibefun/chart',
    modelVisible: true,
    appVisible: true,
    raw: { name: 'chart', inputSchema: { type: 'object' } },
  },
  {
    rawName: 'private-refresh',
    publicName: 'mcp__vibefun__private-refresh',
    inputSchema: { type: 'object' },
    modelVisible: false,
    appVisible: true,
    raw: { name: 'private-refresh', inputSchema: { type: 'object' } },
  },
]

function makeRuntime() {
  const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'updated' }] })
  const client: McpClientLike & ToolCallingClient = {
    async listTools() { return { tools: descriptors.map(item => item.raw) } },
    async listResources() {
      return { resources: [{ uri: 'ui://vibefun/chart' }] }
    },
    async readResource() {
      return {
        contents: [{
          uri: 'ui://vibefun/chart',
          mimeType: 'text/html;profile=mcp-app',
          text: '<main>VibeFun</main>',
        }],
      }
    },
    callTool,
  }
  const runtime: McpServerRuntime = { serverName: 'vibefun', client, descriptors }
  return { runtime, callTool }
}

describe('MCP Apps Host RPC', () => {
  it('lists UI-enabled public tools, annotated with serverName, for client registration', async () => {
    const { runtime } = makeRuntime()
    const handle = createRpcHandler([runtime], 60_000)

    await expect(handle('tools/list-ui', null, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: [{
        serverName: 'vibefun',
        publicName: 'mcp__vibefun__chart',
        rawName: 'chart',
        resourceUri: 'ui://vibefun/chart',
      }],
    })
  })

  it('reads the validated App resource through the matching Server connection', async () => {
    const { runtime } = makeRuntime()
    const handle = createRpcHandler([runtime], 60_000)

    await expect(handle('resources/read', { serverName: 'vibefun', uri: 'ui://vibefun/chart' }, new AbortController().signal))
      .resolves.toEqual({
        ok: true,
        value: { uri: 'ui://vibefun/chart', html: '<main>VibeFun</main>' },
      })
  })

  it('allows a View to call same-server app-visible tools only', async () => {
    const { runtime, callTool } = makeRuntime()
    const handle = createRpcHandler([runtime], 1234)
    const signal = new AbortController().signal

    await expect(handle('tools/call', {
      serverName: 'vibefun',
      name: 'private-refresh',
      arguments: { id: 7 },
    }, signal)).resolves.toEqual({
      ok: true,
      value: { content: [{ type: 'text', text: 'updated' }] },
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'private-refresh', arguments: { id: 7 } },
      { signal, timeout: 1234 },
    )

    await expect(handle('tools/call', { serverName: 'vibefun', name: 'missing', arguments: {} }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
  })

  it('reports reachability from a one-shot connection test', async () => {
    const { runtime } = makeRuntime()
    const testConnection = vi.fn().mockResolvedValue(undefined)
    const handle = createRpcHandler([runtime], 60_000, { baseServers: [], testConnection })
    const signal = new AbortController().signal

    await expect(handle('test', {
      serverName: 'vibefun',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      command: '',
      args: [],
      cwd: '',
    }, signal)).resolves.toEqual({ ok: true, value: { reachable: true } })
    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'vibefun', url: 'https://example.com/mcp' }))
  })

  it('returns reachable=false with a detail when the test connection fails', async () => {
    const { runtime } = makeRuntime()
    const testConnection = vi.fn().mockRejectedValue(new Error('connection refused'))
    const handle = createRpcHandler([runtime], 60_000, { baseServers: [], testConnection })
    const signal = new AbortController().signal

    await expect(handle('test', {
      serverName: 'vibefun',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      command: '',
      args: [],
      cwd: '',
    }, signal)).resolves.toEqual({ ok: true, value: { reachable: false, detail: 'connection refused' } })
  })

  it('rejects calls addressed to an unknown server', async () => {
    const { runtime } = makeRuntime()
    const handle = createRpcHandler([runtime], 60_000)
    const signal = new AbortController().signal

    await expect(handle('tools/call', { serverName: 'ghost', name: 'chart', arguments: {} }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
  })

  it('returns typed bad-request failures for malformed payloads and unknown endpoints', async () => {
    const { runtime } = makeRuntime()
    const handle = createRpcHandler([runtime], 60_000)
    const signal = new AbortController().signal

    await expect(handle('resources/read', { uri: 42 }, signal)).resolves.toMatchObject({ ok: false })
    await expect(handle('unknown', null, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
  })
})
