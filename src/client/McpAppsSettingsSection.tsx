import { useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { McpServerConfig } from '../config.ts'

/** 设置页里可编辑的服务器字段（不包含 headers/env，它们只在 Host 端使用）。 */
interface DraftServer {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  url: string
  command: string
  args: string[]
  cwd: string
}

/** 发送到 Host 做“测试连接”的服务器字段（不携带 headers/env，避免与 strict schema 冲突）。 */
export interface TestServerInput {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  url: string
  command: string
  args: string[]
  cwd: string
}

export interface ServerTestState {
  testing: boolean
  reachable?: boolean
  detail?: string
}

export interface McpAppsState {
  status: 'loading' | 'ready' | 'unavailable'
  servers: DraftServer[]
  writable: boolean
  /** 是否有未保存的草稿改动。 */
  dirty: boolean
  /** 需要重启取生效（本命名空间 applies: 'restart'）。 */
  restartNeeded: boolean
  /** 每个服务器索引对应的连接测试结果。 */
  tests: Record<number, ServerTestState>
  /** 最近一次保存成功后已生效/已存在的服务器列表（用于展示“保存成功”摘要）。 */
  saved: DraftServer[]
}

type Listener = () => void

interface McpAppsFace {
  hooks: {
    /** 当前服务器列表及其编辑状态（getSnapshot/subscribe 满足 HostObservable）。 */
    mcpApps: { getSnapshot: () => McpAppsState; subscribe: (next: () => void) => () => void }
  }
  addServer: () => void
  removeServer: (index: number) => void
  editServer: (index: number, field: keyof DraftServer, value: unknown) => void
  testServer: (index: number) => void
  save: () => Promise<void>
  discard: () => void
}

export type TestConfig = (server: TestServerInput) => Promise<{ reachable: boolean; detail?: string }>

/** 设置页 MCP Apps 设置段的控制器：桥接设置命名空间、草稿编辑状态与连接测试。 */
export class McpAppsSettingsController {
  private listeners = new Set<Listener>()
  private state: McpAppsState
  private draft: DraftServer[]
  private testStates: Record<number, ServerTestState> = {}
  private saved: DraftServer[] = []
  private restartNeeded = false
  /** 用户是否已经手动改过草稿；据此决定是否在被外部设置变化时回填快照。 */
  private edited = false

  constructor(
    private readonly scope: SettingsScope<{ servers: McpServerConfig[] }>,
    private readonly testConfig: TestConfig,
  ) {
    // 用当前 resolved 服务器初始化草稿，作为编辑基线。
    this.draft = (scope.getSnapshot().value?.servers ?? []).map(toDraft)
    this.state = this.compute()
    scope.subscribe(() => this.onScopeChange())
  }

  /** 当前快照（满足 HostObservable 的 getSnapshot 语义）。 */
  getSnapshot = (): McpAppsState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private onScopeChange(): void {
    // 设置文档变了：只要用户还没手动改，就回填快照（覆盖 loading→ready 的首次同步）。
    if (!this.edited) this.draft = (this.scope.getSnapshot().value?.servers ?? []).map(toDraft)
    this.publish()
  }

  addServer = (): void => {
    if (!this.ready() || !this.state.writable) return
    this.draft = [...this.draft, { serverName: '', transport: 'streamable-http', url: '', command: '', args: [], cwd: '' }]
    this.edited = true
    this.restartNeeded = false
    this.saved = []
    this.publish()
  }

  removeServer = (index: number): void => {
    if (!this.ready() || !this.state.writable) return
    this.draft = this.draft.filter((_, idx) => idx !== index)
    this.edited = true
    this.restartNeeded = false
    this.saved = []
    this.publish()
  }

  editServer = (index: number, field: keyof DraftServer, value: unknown): void => {
    if (!this.ready() || !this.state.writable) return
    this.draft = this.draft.map((server, idx) => idx === index ? { ...server, [field]: value } : server)
    this.edited = true
    this.restartNeeded = false
    this.saved = []
    this.publish()
  }

  testServer = async (index: number): Promise<void> => {
    if (!this.ready() || this.draft[index] === undefined) return
    this.testStates = { ...this.testStates, [index]: { testing: true } }
    this.publish()
    try {
      const result = await this.testConfig(toTestInput(this.draft[index]))
      this.testStates = { ...this.testStates, [index]: { testing: false, reachable: result.reachable, detail: result.detail } }
    } catch (error) {
      this.testStates = { ...this.testStates, [index]: { testing: false, reachable: false, detail: error instanceof Error ? error.message : String(error) } }
    }
    this.publish()
  }

  save = async (): Promise<void> => {
    if (!this.ready() || !this.state.writable || !this.dirty()) return
    await this.scope.set('servers', this.draft.map(toServerConfig))
    // 写回成功：命名空间 applies: 'restart'，Host 在下次启动时重新读取连接，故需要重启。
    this.draft = (this.scope.getSnapshot().value?.servers ?? []).map(toDraft)
    this.saved = [...this.draft]
    this.restartNeeded = true
    this.edited = false
    this.testStates = {}
    this.publish()
  }

  discard = (): void => {
    this.draft = (this.scope.getSnapshot().value?.servers ?? []).map(toDraft)
    this.restartNeeded = false
    this.edited = false
    this.testStates = {}
    this.publish()
  }

  face(): McpAppsFace {
    return {
      hooks: { mcpApps: this },
      addServer: this.addServer,
      removeServer: this.removeServer,
      editServer: this.editServer,
      testServer: this.testServer,
      save: this.save,
      discard: this.discard,
    }
  }

  private ready(): boolean {
    return this.state.status === 'ready'
  }

  private dirty(): boolean {
    const current = this.scope.getSnapshot().value?.servers ?? []
    const draft = this.draft.map(toServerConfig)
    const currentStripped = current.map(stripSecrets)
    // 未保存草稿与当前持久化值不同（忽略 secret 字段）即为 dirty。
    return JSON.stringify(draft) !== JSON.stringify(currentStripped)
  }

  private compute(): McpAppsState {
    const snapshot = this.scope.getSnapshot()
    return {
      status: snapshot.status,
      servers: this.draft,
      writable: snapshot.writable,
      dirty: this.dirty(),
      restartNeeded: this.restartNeeded,
      tests: this.testStates,
      saved: this.saved,
    }
  }

  private publish(): void {
    this.state = this.compute()
    for (const listener of this.listeners) listener()
  }
}

function toDraft(server: McpServerConfig): DraftServer {
  return {
    serverName: server.serverName,
    transport: server.transport,
    url: server.url ?? '',
    command: server.command ?? '',
    args: [...server.args],
    cwd: server.cwd,
  }
}

function toServerConfig(draft: DraftServer): McpServerConfig {
  return {
    serverName: draft.serverName.trim(),
    transport: draft.transport,
    url: draft.transport === 'streamable-http' ? draft.url.trim() : '',
    command: draft.transport === 'stdio' ? draft.command.trim() : '',
    args: draft.transport === 'stdio' ? draft.args.map(argument => argument.trim()) : [],
    cwd: draft.transport === 'stdio' ? draft.cwd.trim() : '',
    headers: {},
    env: {},
  }
}

function toTestInput(draft: DraftServer): TestServerInput {
  return {
    serverName: draft.serverName.trim(),
    transport: draft.transport,
    url: draft.transport === 'streamable-http' ? draft.url.trim() : '',
    command: draft.transport === 'stdio' ? draft.command.trim() : '',
    args: draft.transport === 'stdio' ? draft.args.map(argument => argument.trim()) : [],
    cwd: draft.transport === 'stdio' ? draft.cwd.trim() : '',
  }
}

function stripSecrets(server: McpServerConfig): McpServerConfig {
  return { ...server, headers: {}, env: {} }
}

interface McpAppsSectionProps extends McpAppsFace {
  useMcpApps: <S>(selector: (state: McpAppsState) => S) => S
}

/** 设置页“MCP 服务器”段：展示并可编辑/新增/删除 MCP 服务器，可测试连接，保存后提示重启。 */
export function McpAppsSettingsSection({ useMcpApps, addServer, removeServer, editServer, testServer, save, discard }: McpAppsSectionProps) {
  const state = useMcpApps((snapshot) => snapshot)
  const [error, setError] = useState<string | null>(null)

  if (state.status === 'loading') return <p style={styles.hint}>正在加载 MCP 服务器…</p>
  if (state.status === 'unavailable') return <p style={styles.hint}>本会话无法使用 MCP 服务器设置。</p>

  const runSave = async () => {
    setError(null)
    try {
      await save()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <section style={styles.section} aria-label="MCP 服务器设置">
      <h2 style={styles.heading}>MCP 服务器</h2>
      <p style={styles.intro}>管理本部署连接到的 MCP 服务器。保存后的改动需重启 DSH 才能生效。</p>

      {state.restartNeeded && (
        <p role="status" style={styles.restart}>需要重启：连接在启动时建立，保存的改动将在重启后生效。</p>
      )}
      {state.saved.length > 0 && (
        <div style={styles.savedBox} role="status">
          <p style={styles.savedTitle}>保存成功，以下 MCP 服务器已保存：</p>
          <ul style={styles.savedList}>
            {state.saved.map((server, idx) => (
              <li key={idx}>{server.serverName || '(未命名)'} · {transportLabel(server.transport)}</li>
            ))}
          </ul>
        </div>
      )}
      {error !== null && <p role="alert" style={styles.error}>{error}</p>}

      <div style={styles.list}>
        {state.servers.map((server, index) => (
          // 用稳定 index 作为 key，避免编辑名称时因 key 变化导致卡片重挂、输入丢失。
          <fieldset key={index} style={styles.card} disabled={!state.writable}>
            <label style={styles.field}>
              <span style={styles.label}>名称</span>
              <input style={styles.input} value={server.serverName} onChange={event => editServer(index, 'serverName', event.target.value)} disabled={!state.writable} />
            </label>
            <label style={styles.field}>
              <span style={styles.label}>传输方式</span>
              <select style={styles.input} value={server.transport} onChange={event => editServer(index, 'transport', event.target.value)} disabled={!state.writable}>
                <option value="streamable-http">Streamable HTTP</option>
                <option value="stdio">stdio</option>
              </select>
            </label>
            {server.transport === 'streamable-http' ? (
              <label style={styles.field}>
                <span style={styles.label}>端点地址</span>
                <input style={styles.input} value={server.url} placeholder="https://主机/mcp" onChange={event => editServer(index, 'url', event.target.value)} disabled={!state.writable} />
              </label>
            ) : (
              <>
                <label style={styles.field}>
                  <span style={styles.label}>启动命令</span>
                  <input style={styles.input} value={server.command} placeholder="node" onChange={event => editServer(index, 'command', event.target.value)} disabled={!state.writable} />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>参数（空格分隔）</span>
                  <input style={styles.input} value={server.args.join(' ')} placeholder="server.js --port 3000" onChange={event => editServer(index, 'args', event.target.value.split(' ').filter(Boolean))} disabled={!state.writable} />
                </label>
                <label style={styles.field}>
                  <span style={styles.label}>工作目录</span>
                  <input style={styles.input} value={server.cwd} onChange={event => editServer(index, 'cwd', event.target.value)} disabled={!state.writable} />
                </label>
              </>
            )}
            <TestResult test={state.tests[index]} />
            <div style={styles.actions}>
              <button type="button" style={styles.test} disabled={!state.writable} onClick={() => testServer(index)}>测试连接</button>
              <button type="button" style={styles.remove} disabled={!state.writable} onClick={() => removeServer(index)}>删除</button>
            </div>
          </fieldset>
        ))}
      </div>

      <button type="button" style={styles.add} disabled={!state.writable} onClick={addServer}>添加 MCP 服务器</button>

      <div style={styles.footer}>
        <button type="button" style={styles.discard} disabled={!state.dirty} onClick={discard}>放弃修改</button>
        <button type="button" style={styles.save} disabled={!state.dirty || !state.writable} onClick={runSave}>保存</button>
      </div>
    </section>
  )
}

function TestResult({ test }: { test: ServerTestState | undefined }) {
  if (test === undefined) return null
  if (test.testing) return <p style={styles.testing}>测试中…</p>
  if (test.reachable === true) return <p style={styles.ok}>连接成功（可达）</p>
  return <p style={styles.fail}>连接失败{test.detail ? `：${test.detail}` : ''}</p>
}

function transportLabel(transport: 'stdio' | 'streamable-http'): string {
  return transport === 'streamable-http' ? 'Streamable HTTP' : 'stdio'
}

const styles = {
  section: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12 },
  heading: { margin: 0, fontSize: 18, fontWeight: 600 },
  intro: { color: 'var(--dsw-alias-label-tertiary)', margin: 0, fontSize: 13 },
  restart: { color: 'var(--dsw-alias-state-business-primary)', margin: 0, fontSize: 13 },
  error: { color: 'var(--dsw-alias-label-error)', margin: 0, fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--dsw-alias-bg-layer-3)' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
  input: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '6px 10px', fontSize: 13, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  test: { background: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  remove: { background: 'none', border: 'none', color: 'var(--dsw-alias-label-error)', fontSize: 12, cursor: 'pointer' },
  testing: { color: 'var(--dsw-alias-label-tertiary)', margin: 0, fontSize: 12 },
  ok: { color: '#16a34a', margin: 0, fontSize: 12, fontWeight: 600 },
  fail: { color: '#dc2626', margin: 0, fontSize: 12, wordBreak: 'break-word', fontWeight: 600 },
  savedBox: { color: '#15803d', background: 'rgba(22, 163, 74, 0.08)', border: '1px solid #16a34a', borderRadius: 8, padding: '10px 12px' },
  savedTitle: { margin: 0, fontSize: 13, fontWeight: 600 },
  savedList: { margin: '6px 0 0', paddingLeft: 18, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 },
  add: { background: 'var(--dsw-alias-border-l2)', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', alignSelf: 'flex-start' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  discard: { background: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer' },
  save: { background: 'var(--dsw-alias-brand-primary)', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, color: 'var(--dsw-alias-bg-layer-1)', cursor: 'pointer' },
  hint: { color: 'var(--dsw-alias-label-tertiary)', margin: 0, fontSize: 13 },
} as const
