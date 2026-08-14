import Schema from '@deepseek-ai/schemastery'

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export interface SharedConfig {
  serverName: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
}

export interface SharedConfigInput {
  serverName: string
  toolCallTimeoutMs?: number
  failOnStartupError?: boolean
}

export interface StdioConfig extends SharedConfig {
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
}

export interface StdioConfigInput extends SharedConfigInput {
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface StreamableHttpConfig extends SharedConfig {
  transport: 'streamable-http'
  url: string
  headers: Record<string, string>
}

export interface StreamableHttpConfigInput extends SharedConfigInput {
  transport: 'streamable-http'
  url: string
  headers?: Record<string, string>
}

export type Config = StdioConfig | StreamableHttpConfig
export type ConfigInput = StdioConfigInput | StreamableHttpConfigInput

const shared = {
  serverName: Schema.string().required().pattern(SERVER_NAME_PATTERN),
  toolCallTimeoutMs: Schema.number().min(1).default(60_000),
  failOnStartupError: Schema.boolean().default(false),
}

const ConfigUnion = Schema.union([
  Schema.object({
    ...shared,
    transport: Schema.const('stdio'),
    command: Schema.string().required(),
    args: Schema.array(String).default([]),
    env: Schema.dict(String).default({}),
    cwd: Schema.string().default(''),
  }),
  Schema.object({
    ...shared,
    transport: Schema.const('streamable-http'),
    url: Schema.string().required(),
    headers: Schema.dict(String).default({}),
  }),
])

// `transform` validates the selected object branch in strict mode, so stale
// fields from a previous transport choice cannot leak into runtime config.
export const ConfigSchema = Schema.transform(ConfigUnion, value => value, true) as Schema<ConfigInput, Config>

export const Config = ConfigSchema
