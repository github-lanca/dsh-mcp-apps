import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createMcpClient } from '../src/connection.ts'
import { discoverTools, readAppResource } from '../src/protocol.ts'

describe('real MCP Apps stdio integration', () => {
  it('discovers, calls, reads UI HTML, and closes a real Server', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/mcp-app-server.mjs', import.meta.url))
    const connected = await createMcpClient({
      transport: 'stdio',
      serverName: 'fixture',
      command: process.execPath,
      args: [fixture],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 5_000,
      failOnStartupError: true,
    })

    try {
      const tools = await discoverTools(connected.client, 'fixture')
      expect(tools.map(tool => ({ name: tool.rawName, uri: tool.resourceUri }))).toEqual([
        { name: 'make_chart', uri: 'ui://fixture/chart' },
      ])
      await expect(connected.client.callTool(
        { name: 'make_chart', arguments: { values: [2, 4, 8] } },
        { signal: new AbortController().signal, timeout: 5_000 },
      )).resolves.toMatchObject({
        content: [{ type: 'text', text: 'Chart ready' }],
        structuredContent: { values: [2, 4, 8] },
      })
      await expect(readAppResource(connected.client, 'ui://fixture/chart')).resolves.toMatchObject({
        html: expect.stringContaining('Fixture Chart'),
      })
    } finally {
      await connected.close()
    }
  })
})
