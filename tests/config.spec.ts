import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../src/config.ts'

describe('MCP Apps plugin configuration', () => {
  it('fills safe defaults for a stdio server', () => {
    expect(ConfigSchema({
      transport: 'stdio',
      serverName: 'vibefun',
      command: 'npx',
    })).toEqual({
      transport: 'stdio',
      serverName: 'vibefun',
      command: 'npx',
      args: [],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    })
  })

  it('accepts a Streamable HTTP server with headers', () => {
    expect(ConfigSchema({
      transport: 'streamable-http',
      serverName: 'vibefun',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer secret' },
    })).toMatchObject({
      transport: 'streamable-http',
      headers: { Authorization: 'Bearer secret' },
      toolCallTimeoutMs: 60_000,
    })
  })

  it.each(['', 'contains space', 'x'.repeat(33)])('rejects invalid serverName %j', (serverName) => {
    expect(() => ConfigSchema({
      transport: 'stdio',
      serverName,
      command: 'node',
    })).toThrow()
  })

  it('drops transport-specific fields from the other transport', () => {
    expect(ConfigSchema({
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'https://example.com/mcp',
      command: 'node',
    })).not.toHaveProperty('command')
  })
})
