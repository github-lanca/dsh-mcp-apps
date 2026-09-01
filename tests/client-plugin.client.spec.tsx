// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'

const UI_TOOLS = [
  { serverName: 'vibefun', publicName: 'mcp__vibefun__chart', rawName: 'chart', resourceUri: 'ui://vibefun/chart' },
  { serverName: 'vibefun', publicName: 'mcp__vibefun__map', rawName: 'map', resourceUri: 'ui://vibefun/map' },
]

class ConnectionService extends Service {
  call = vi.fn(async (_channel: string, endpoint: string) => {
    if (endpoint === 'tools/list-ui') return { ok: true, value: UI_TOOLS }
    return { ok: false, error: { code: 'bad-request', message: 'unknown endpoint', details: { issues: [] } } }
  })
  rpc = { call: this.call }

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }
}

class SlotsService extends Service {
  registrations: Array<{ options: { name: string; key?: string; id?: string }; component: unknown }> = []

  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  inject = (_name: string, callback: () => (() => void)) => callback()

  register = (options: { name: string; key?: string; id?: string }, component: unknown) => {
    const entry = { options, component }
    this.registrations.push(entry)
    return () => {
      const index = this.registrations.indexOf(entry)
      if (index >= 0) this.registrations.splice(index, 1)
    }
  }

  entries = (name: string) => this.registrations.filter(entry => entry.options.name === name)
}

class SettingsScopeService extends Service {
  bind = vi.fn(() => ({
    getSnapshot: () => ({ status: 'ready' as const, value: { servers: [] }, base: undefined, user: undefined, revision: 0, writable: true, mode: 'host' as const }),
    subscribe: () => () => {},
    set: vi.fn(),
    unset: vi.fn(),
    mutate: vi.fn(),
  }))

  constructor(ctx: Context) {
    super(ctx, 'settingsScope')
  }
}

async function bench() {
  const ctx = new Context()
  const connection = new ConnectionService(ctx)
  new SlotsService(ctx)
  new SettingsScopeService(ctx)
  const fiber = ctx.plugin({ inject: ['connection', 'slots', 'settingsScope'], apply })
  await fiber.await()
  return { ctx, connection, fiber }
}

describe('MCP Apps browser plugin', () => {
  it('discovers UI tools through Host RPC and registers keyed call views', async () => {
    const b = await bench()

    expect(b.connection.call).toHaveBeenCalledWith('/mcp-apps', 'tools/list-ui', null)
    expect(b.ctx.slots.entries('tool.call.toolview').map(entry => entry.options.key)).toEqual([
      'mcp__vibefun__chart',
      'mcp__vibefun__map',
    ])
  })

  it('registers a dedicated MCP Apps settings section', async () => {
    const b = await bench()
    expect(b.ctx.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['mcp-apps'])
  })

  it('removes every dynamic tool view and settings section when the client fiber stops', async () => {
    const b = await bench()
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('tool.call.toolview')).toHaveLength(0)
    expect(b.ctx.slots.entries('settings.section')).toHaveLength(0)
  })

  it('fails activation when Host discovery fails instead of masking a half-mounted UI', async () => {
    const ctx = new Context()
    const connection = new ConnectionService(ctx)
    connection.call.mockResolvedValue({
      ok: false,
      error: { code: 'bad-request', message: 'server unavailable', details: { issues: [] } },
    })
    new SlotsService(ctx)
    new SettingsScopeService(ctx)

    const fiber = ctx.plugin({ inject: ['connection', 'slots', 'settingsScope'], apply })
    await expect(fiber.await()).rejects.toThrow('server unavailable')
  })
})
