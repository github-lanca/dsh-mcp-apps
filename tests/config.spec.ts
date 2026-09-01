import { describe, expect, it } from 'vitest'
import { ConfigSchema, McpAppsNamespaceSchema } from '../src/config.ts'

describe('MCP Apps plugin configuration', () => {
  it('fills safe defaults for the manager config', () => {
    expect(ConfigSchema({ servers: [{ serverName: 'vibefun', transport: 'streamable-http', url: 'https://vibefun.app/api/mcp' }] })).toEqual({
      servers: [{
        serverName: 'vibefun',
        transport: 'streamable-http',
        url: 'https://vibefun.app/api/mcp',
        command: '',
        args: [],
        cwd: '',
        headers: {},
        env: {},
      }],
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  })

  it('accepts a stdio server with command and args', () => {
    const config = ConfigSchema({ servers: [{ serverName: 'local', transport: 'stdio', command: 'node', args: ['server.js'] }] })
    expect(config.servers[0]).toMatchObject({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      url: '',
    })
  })

  it.each(['', 'contains space', 'x'.repeat(33)])('rejects invalid serverName %j', (serverName) => {
    expect(() => ConfigSchema({ servers: [{ serverName, transport: 'stdio', command: 'node' }] })).toThrow()
  })

  it('marks headers and env as secret in the namespace schema', () => {
    const servers = McpAppsNamespaceSchema({ servers: [{ serverName: 'vibefun', transport: 'streamable-http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret' }, env: { TOKEN: 'x' } }] })
    expect(servers.servers[0].headers).toEqual({ Authorization: 'Bearer secret' })
    expect(servers.servers[0].env).toEqual({ TOKEN: 'x' })
  })
})
