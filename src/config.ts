import Schema from '@deepseek-ai/schemastery'

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * 一个可管理、可编辑的 MCP Server 配置。
 * `url` 与 `command` 按 `transport` 二选一：streamable-http 用 url，stdio 用 command/args/cwd。
 * `headers`/`env` 标记为 secret，浏览器永远拿不回它们的值，只在 Host 端用于建立连接。
 */
export interface McpServerConfig {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  /** endpoint；stdio 下为空字符串。 */
  url: string
  /** 启动命令；streamable-http 下为空字符串。 */
  command: string
  args: string[]
  cwd: string
  headers: Record<string, string>
  env: Record<string, string>
}

export interface McpServerConfigInput {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  url?: string
  command?: string
  args?: string[]
  cwd?: string
  headers?: Record<string, string>
  env?: Record<string, string>
}

/**
 * 管理器插件配置：`servers` 是组成层（cordis.patch.yml）给出的默认服务器列表，
 * 实际生效的服务器由设置命名空间 `mcp-apps` 解析得到（默认层 + 用户层叠加）。
 */
export interface Config {
  servers: McpServerConfig[]
  toolCallTimeoutMs: number
  failOnStartupError: boolean
}

export interface ConfigInput {
  servers: McpServerConfigInput[]
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
}

const McpServerSchema = Schema.object({
  serverName: Schema.string().required().pattern(SERVER_NAME_PATTERN),
  transport: Schema.union([Schema.const('stdio'), Schema.const('streamable-http')]),
  url: Schema.string().default(''),
  command: Schema.string().default(''),
  args: Schema.array(String).default([]),
  cwd: Schema.string().default(''),
  headers: Schema.dict(String).default({}).role('secret'),
  env: Schema.dict(String).default({}).role('secret'),
})

// 设置命名空间 `mcp-apps` 的 schema：只承载服务器列表，供设置页编辑与 Host 启动时读取。
export const McpAppsNamespaceSchema = Schema.object({
  servers: Schema.array(McpServerSchema).default([]),
})

export const ConfigSchema = Schema.transform(
  Schema.object({
    servers: Schema.array(McpServerSchema).default([]),
    toolCallTimeoutMs: Schema.number().min(1).default(60_000),
    failOnStartupError: Schema.boolean().default(false),
  }),
  value => value,
  true,
) as Schema<ConfigInput, Config>

export const Config = ConfigSchema
