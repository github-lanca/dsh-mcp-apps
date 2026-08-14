import { describe, expect, it, vi } from 'vitest'
import { createRpcHandler } from '../src/rpc.ts'
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

function makeClient() {
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
  return { client, callTool }
}

describe('MCP Apps Host RPC', () => {
  it('lists UI-enabled public tools for client slot registration', async () => {
    const { client } = makeClient()
    const handle = createRpcHandler(client, descriptors, 60_000)

    await expect(handle('tools/list-ui', null, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: [{ publicName: 'mcp__vibefun__chart', rawName: 'chart', resourceUri: 'ui://vibefun/chart' }],
    })
  })

  it('reads the validated App resource through the Host connection', async () => {
    const { client } = makeClient()
    const handle = createRpcHandler(client, descriptors, 60_000)

    await expect(handle('resources/read', { uri: 'ui://vibefun/chart' }, new AbortController().signal))
      .resolves.toEqual({
        ok: true,
        value: { uri: 'ui://vibefun/chart', html: '<main>VibeFun</main>' },
      })
  })

  it('allows a View to call same-server app-visible tools only', async () => {
    const { client, callTool } = makeClient()
    const handle = createRpcHandler(client, descriptors, 1234)
    const signal = new AbortController().signal

    await expect(handle('tools/call', {
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

    await expect(handle('tools/call', { name: 'missing', arguments: {} }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
  })

  it('returns typed bad-request failures for malformed payloads and unknown endpoints', async () => {
    const { client } = makeClient()
    const handle = createRpcHandler(client, descriptors, 60_000)
    const signal = new AbortController().signal

    await expect(handle('resources/read', { uri: 42 }, signal)).resolves.toMatchObject({ ok: false })
    await expect(handle('unknown', null, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
  })
})
