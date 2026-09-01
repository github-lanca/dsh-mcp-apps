import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { applyWithClientFactory, type ConnectedMcpClient } from '../src/index.ts'
import type { Config } from '../src/config.ts'

class ToolsService extends Service {
  definitions = new Map<string, unknown>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register = (definition: { name: string }) => {
    if (this.definitions.has(definition.name)) throw new Error(`duplicate ${definition.name}`)
    this.definitions.set(definition.name, definition)
    return () => { this.definitions.delete(definition.name) }
  }
}

class ConnectionService extends Service {
  handle = vi.fn(() => vi.fn())
  rpc = { handle: this.handle }

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }
}

class SettingsService extends Service {
  register = vi.fn((_ns: string, _schema: unknown, options?: { base?: { servers: unknown[] } }) => ({
    get: () => ({ servers: options?.base?.servers ?? [] }),
  }))

  constructor(ctx: Context) {
    super(ctx, 'settings')
  }
}

const server = {
  serverName: 'vibefun',
  transport: 'streamable-http' as const,
  url: 'https://example.com/mcp',
  command: '',
  args: [],
  cwd: '',
  headers: {},
  env: {},
}

const config: Config = {
  servers: [server],
  toolCallTimeoutMs: 60_000,
  failOnStartupError: true,
}

function connected(close = vi.fn()): ConnectedMcpClient {
  return {
    client: {
      async listTools() {
        return {
          tools: [{
            name: 'chart',
            description: 'Draw a chart',
            inputSchema: { type: 'object' as const },
            _meta: { ui: { resourceUri: 'ui://vibefun/chart' } },
          }],
        }
      },
      async listResources() { return { resources: [] } },
      async readResource() { return { contents: [] } },
      async callTool() { return { content: [{ type: 'text', text: 'ok' }] } },
    },
    close,
  }
}

describe('Cordis MCP Apps plugin lifecycle', () => {
  it('connects, discovers, registers, and disposes one server generation', async () => {
    const ctx = new Context()
    const tools = new ToolsService(ctx)
    const connection = new ConnectionService(ctx)
    new SettingsService(ctx)
    const close = vi.fn()
    const factory = vi.fn().mockResolvedValue(connected(close))

    const fiber = ctx.plugin({
      inject: ['tools', 'connection', 'settings'],
      apply: pluginCtx => applyWithClientFactory(pluginCtx, config, factory),
    })
    await fiber.await()

    expect(factory).toHaveBeenCalledWith(server)
    expect([...tools.definitions.keys()]).toEqual(['mcp__vibefun__chart'])
    expect(connection.handle).toHaveBeenCalledWith('/mcp-apps', expect.any(Function))

    await fiber.dispose()
    expect(tools.definitions.size).toBe(0)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects activation when strict startup cannot connect', async () => {
    const ctx = new Context()
    new ToolsService(ctx)
    new ConnectionService(ctx)
    new SettingsService(ctx)
    const factory = vi.fn().mockRejectedValue(new Error('offline'))

    const fiber = ctx.plugin({
      inject: ['tools', 'connection', 'settings'],
      apply: pluginCtx => applyWithClientFactory(pluginCtx, config, factory),
    })

    await expect(fiber.await()).rejects.toThrow('offline')
  })

  it('activates empty when non-strict startup cannot connect', async () => {
    const ctx = new Context()
    const tools = new ToolsService(ctx)
    new ConnectionService(ctx)
    new SettingsService(ctx)
    const factory = vi.fn().mockRejectedValue(new Error('offline'))
    const loggerError = vi.spyOn(ctx.logger, 'error').mockImplementation(() => undefined)

    const fiber = ctx.plugin({
      inject: ['tools', 'connection', 'settings'],
      apply: pluginCtx => applyWithClientFactory(pluginCtx, { ...config, failOnStartupError: false }, factory),
    })
    await fiber.await()

    expect(tools.definitions.size).toBe(0)
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('offline'))
    await fiber.dispose()
  })
})
