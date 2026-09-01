import { describe, expect, it, vi } from 'vitest'
import { McpAppsSettingsController } from '../src/client/McpAppsSettingsSection.tsx'
import type { McpServerConfig } from '../src/config.ts'

function makeScope(servers: McpServerConfig[]) {
  let value = { servers }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready' as const, value, base: undefined, user: undefined, revision: 0, writable: true, mode: 'host' as const }),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) },
    set: vi.fn(async (_field: string, next: unknown) => {
      // 模拟 Host 写回后快照更新，并触发订阅（用于验证 loading→ready 等场景）。
      value = { servers: next as McpServerConfig[] }
      for (const l of listeners) l()
    }),
    unset: vi.fn(),
    mutate: vi.fn(),
  } as never
}

function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    serverName: 'vibefun',
    transport: 'streamable-http',
    url: 'https://vibefun.app/api/mcp',
    command: '',
    args: [],
    cwd: '',
    headers: {},
    env: {},
    ...overrides,
  }
}

describe('MCP Apps settings controller', () => {
  it('seeds the draft from the resolved servers', () => {
    const ctl = new McpAppsSettingsController(makeScope([makeServer()]), async () => ({ reachable: true }))
    expect(ctl.getSnapshot().servers).toHaveLength(1)
    expect(ctl.getSnapshot().dirty).toBe(false)
  })

  it('becomes dirty after an edit, then saves and marks restart needed', async () => {
    const ctl = new McpAppsSettingsController(makeScope([makeServer()]), async () => ({ reachable: true }))
    ctl.editServer(0, 'url', 'https://new.example.com/mcp')
    expect(ctl.getSnapshot().dirty).toBe(true)

    await ctl.save()
    const state = ctl.getSnapshot()
    expect(state.dirty).toBe(false)
    expect(state.restartNeeded).toBe(true)
    expect(state.saved).toHaveLength(1)
    expect(state.saved[0].url).toBe('https://new.example.com/mcp')
  })

  it('adds and removes a server, tracking dirty state', () => {
    const ctl = new McpAppsSettingsController(makeScope([makeServer()]), async () => ({ reachable: true }))
    ctl.addServer()
    expect(ctl.getSnapshot().servers).toHaveLength(2)
    expect(ctl.getSnapshot().dirty).toBe(true)

    ctl.removeServer(1)
    expect(ctl.getSnapshot().servers).toHaveLength(1)
  })

  it('resyncs the draft when the settings scope publishes while not edited', () => {
    const scope = makeScope([makeServer()])
    const ctl = new McpAppsSettingsController(scope, async () => ({ reachable: true }))
    expect(ctl.getSnapshot().servers).toHaveLength(1)

    // 模拟外部把服务器改成一个新列表：用户尚未编辑，应回填。
    const next: McpServerConfig = makeServer({ serverName: 'other', url: 'https://other.example.com/mcp' })
    ;(scope as unknown as { set: ReturnType<typeof vi.fn> }).set('servers', [next])
    expect(ctl.getSnapshot().servers[0].serverName).toBe('other')
  })
})
