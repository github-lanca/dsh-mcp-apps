# DSH MCP Apps 复刻实现规格

## 1. 文档目的

本文档描述当前 `@sugarforever/dsh-mcp-apps` 的真实实现，目标是让另一个开发者仅根据本文档和公开依赖，重新实现行为基本一致的版本。

本文档以当前源码和测试为准，不以历史设计计划中的未落地内容为准。当前实现是一个 TypeScript、Cordis、MCP SDK、React 和 Vitest 项目。

## 2. 项目定位

这是一个 DeepSeek Harness 双入口 Cordis 插件：

- Host 入口持有真实 MCP Client。
- Host 入口连接一个 MCP Server，并把模型可见工具注册为 Harness 工具。
- Web Client 入口通过 Harness Connection 的 loopback RPC 与 Host 通信。
- 带 MCP App UI 的工具在 Harness 会话中渲染为 sandbox iframe。
- 浏览器永远不直接访问 MCP Server。

基础数据流：

```text
模型
  │
  ▼
Harness 原生工具
  │
  ▼
Host MCP Client
  │
  ▼
MCP Server
```

带 UI 的工具调用：

```text
MCP CallToolResult
  │
  ├── content / structuredContent 给 Harness 模型结果
  └── mcpApp metadata 给 Web Client 定位 UI
          │
          ▼
    Host RPC 读取 ui:// HTML
          │
          ▼
    srcdoc sandbox iframe
          │
          ▼
    AppBridge + PostMessageTransport
```

## 3. 文件结构

```text
src/
├── index.ts                 Host 插件入口和生命周期
├── config.ts                配置类型和 schemastery schema
├── connection.ts            stdio/HTTP MCP 连接
├── protocol.ts              MCP Apps 发现、命名、资源读取
├── tools.ts                 MCP Tool 到 Harness Tool 的转换
├── rpc.ts                   Host RPC 路由
└── client/
    ├── index.tsx            Web Client 插件入口
    ├── McpAppToolView.tsx   Harness 工具 UI
    └── bridge.ts            AppBridge 和 RPC 转发

tests/
├── config.spec.ts
├── protocol.spec.ts
├── tools.spec.ts
├── rpc.spec.ts
├── plugin.spec.ts
├── integration.spec.ts
├── client-plugin.client.spec.tsx
├── app-view.client.spec.tsx
├── client-bundle-config.spec.ts
└── fixtures/mcp-app-server.mjs

docs/
├── architecture.md
├── security.md
└── reimplementation-spec.md
```

历史计划中提到的 `sandbox.ts`、`sandbox.html`、`mcp-apps.css` 当前不存在。实际实现使用单个 `iframe`，通过 `srcDoc` 注入 HTML。

## 4. Host 插件入口

实现文件：[src/index.ts](../src/index.ts)

入口导出：

```ts
export const name = 'mcp-apps'
export const inject = ['tools', 'connection']
export const Config = ConfigSchema
```

主流程：

```text
apply(ctx, config)
  │
  ├── createMcpClient(config)
  │
  ├── discoverTools(client, config.serverName)
  │
  ├── createToolDefinitions(...)
  │
  ├── 注册 /mcp-apps RPC
  │       authority = loopback
  │
  └── 注册所有模型可见 Harness Tool
```

`applyWithClientFactory` 用于注入测试工厂，真实入口 `apply` 使用 `createMcpClient`。

生命周期必须保持以下顺序：

1. 调用工厂创建 MCP Client。
2. 连接失败时根据 `failOnStartupError` 决定抛错或记录错误并结束激活。
3. 注册 MCP 连接关闭 effect。
4. 分页读取 `tools/list`。
5. 创建 Harness 工具定义。
6. 注册 `/mcp-apps` loopback RPC。
7. 注册所有 Harness 工具。
8. Cordis fiber 销毁时清理工具、RPC 和 MCP 连接。

启动失败规则：

- `failOnStartupError: true`：插件激活失败，原始错误继续抛出。
- `failOnStartupError: false`：记录错误日志，插件以没有工具的状态继续运行。

错误日志格式包含服务器名，例如：

```text
mcp-apps(vibefun): startup failed: offline
```

## 5. 配置系统

实现文件：[src/config.ts](../src/config.ts)

使用 `@deepseek-ai/schemastery` 定义严格联合配置。

### 5.1 配置类型

```ts
type Config = StdioConfig | StreamableHttpConfig
```

stdio 分支：

```ts
interface StdioConfig {
  transport: 'stdio'
  serverName: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
}
```

Streamable HTTP 分支：

```ts
interface StreamableHttpConfig {
  transport: 'streamable-http'
  serverName: string
  url: string
  headers: Record<string, string>
  toolCallTimeoutMs: number
  failOnStartupError: boolean
}
```

### 5.2 校验和默认值

- `serverName` 必须匹配 `/^[A-Za-z0-9_-]{1,32}$/`。
- `toolCallTimeoutMs` 默认 `60000`，最小值为 `1`。
- `failOnStartupError` 默认 `false`。
- stdio `args` 默认 `[]`。
- stdio `env` 默认 `{}`。
- stdio `cwd` 默认空字符串。
- HTTP `headers` 默认 `{}`。
- 配置使用严格 transform。
- HTTP 输入中的 `command` 等 stdio 字段不能泄漏到最终配置。

当前默认 VibeFun patch：[cordis.patch.yml](../cordis.patch.yml)

```yaml
- insert:
    - id: mcp-apps-vibefun
      name: '@sugarforever/dsh-mcp-apps'
      config:
        serverName: vibefun
        transport: streamable-http
        url: https://vibefun.app/api/mcp
        failOnStartupError: true
```

## 6. MCP 连接

实现文件：[src/connection.ts](../src/connection.ts)

### 6.1 MCP Client

使用官方 `@modelcontextprotocol/sdk` Client：

```ts
new Client(
  {
    name: '@sugarforever/dsh-mcp-apps',
    version: '0.1.0',
  },
  {
    capabilities: {
      extensions: {
        'io.modelcontextprotocol/ui': {
          mimeTypes: ['text/html;profile=mcp-app'],
        },
      },
    },
  },
)
```

### 6.2 stdio Transport

```ts
new StdioClientTransport({
  command: config.command,
  args: config.args,
  env: {
    ...getDefaultEnvironment(),
    ...config.env,
  },
  ...(config.cwd === '' ? {} : { cwd: config.cwd }),
})
```

用户配置的环境变量覆盖 SDK 默认环境变量。

### 6.3 Streamable HTTP Transport

```ts
new StreamableHTTPClientTransport(new URL(config.url), {
  requestInit: {
    headers: config.headers,
  },
})
```

### 6.4 连接异常

`client.connect(transport)` 失败时：

1. 尝试关闭 transport。
2. 忽略 transport close 错误。
3. 重新抛出连接原始错误。

对 Host 其他模块只暴露最小接口：

```ts
{
  client: {
    listTools,
    listResources,
    readResource,
    callTool,
  },
  close,
}
```

## 7. 工具发现和描述

实现文件：[src/protocol.ts](../src/protocol.ts)

### 7.1 AppToolDescriptor

```ts
interface AppToolDescriptor {
  rawName: string
  publicName: string
  inputSchema: Tool['inputSchema']
  description?: string
  outputSchema?: Tool['outputSchema']
  resourceUri?: string
  modelVisible: boolean
  appVisible: boolean
  raw: Tool
}
```

### 7.2 分页

`discoverTools` 完整消费 MCP `tools/list` 分页：

```text
listTools()
  │
  ├── 读取当前页
  ├── 检查每个工具名是否重复
  ├── 转换为 AppToolDescriptor
  ├── 读取 nextCursor
  └── 继续下一页
```

同一个 MCP Server 重复返回相同工具名时抛错。

### 7.3 UI Resource URI

使用 `@modelcontextprotocol/ext-apps/app-bridge` 的 `getToolUiResourceUri`。

支持：

```ts
_meta.ui.resourceUri
_meta['ui/resourceUri']
```

嵌套格式优先。若 metadata 中声明了 URI，URI 必须以 `ui://` 开头，否则发现阶段抛出错误。

### 7.4 可见性

```ts
modelVisible = !isToolVisibilityAppOnly(tool)
appVisible = !isToolVisibilityModelOnly(tool)
```

含义：

| MCP 工具类型 | 模型 | App |
|---|---:|---:|
| 普通工具 | 可见 | 可见 |
| model-only | 可见 | 不可见 |
| app-only | 不可见 | 可见 |

### 7.5 publicName

初始格式：

```text
mcp__<serverName>__<rawName>
```

名称处理规则：

1. 只保留 `A-Z`、`a-z`、`0-9`、`_`、`-`。
2. 其他字符替换成 `_`。
3. 最大长度为 64。
4. 如果名称发生替换，或原名称超长，则计算：
   ```text
   sha256(serverName + "\0" + rawName)
   ```
5. 取 hash 前 12 位十六进制字符。
6. 截断规范化名称，再追加 `_` 和 hash。

最终格式类似：

```text
mcp__vibefun__chart
```

超长或含非法字符时，最终长度仍不超过 64。

## 8. MCP App 资源读取

函数：`readAppResource(client, uri)`。

处理顺序：

1. 分页调用 `resources/list`。
2. 按资源 URI 保存 listing 元数据。
3. 调用 `resources/read`。
4. 返回内容数量必须恰好为 1。
5. MIME 必须是：
   ```text
   text/html;profile=mcp-app
   ```
6. 优先读取 `content.text`。
7. 没有 `text` 时，Base64 解码 `content.blob`。
8. 两者都没有时抛错。
9. 读取 CSP 和 Permission Policy 元数据。

返回：

```ts
interface AppResourcePayload {
  uri: string
  html: string
  csp?: Record<string, unknown>
  permissions?: Record<string, Record<string, never>>
}
```

元数据优先级：

```text
content._meta.ui
  > content.meta.ui
  > resources/list 项目的 _meta.ui
```

当前实现不会强制确认 URI 必须存在于 `resources/list`；只要 `resources/read` 成功即可。

## 9. Harness 工具转换

实现文件：[src/tools.ts](../src/tools.ts)

只有 `modelVisible === true` 的工具会注册为 Harness 工具。

### 9.1 注册定义

```ts
{
  name: tool.publicName,
  description: tool.description ?? '',
  parameters: tool.inputSchema,
  timeoutMs: toolCallTimeoutMs,
  output: {
    schema,
    render,
    presentationMeta,
  },
  execute,
}
```

### 9.2 输出 schema

Harness 输出统一包装为：

```ts
{
  type: 'object',
  properties: {
    content: {
      type: 'array',
      items: {},
    },
    structuredContent: supportedOutputSchema(tool.outputSchema) ?? {},
  },
  required: ['content'],
  additionalProperties: false,
}
```

MCP 支持完整 JSON Schema，但 Harness 支持的是较小子集。调用 `assertSupportedJsonSchema` 检查失败时，将 `structuredContent` schema 降级为 `{}`，不阻止整个 Server 加载。

### 9.3 execute

执行顺序：

1. 参数是普通对象时使用原参数。
2. 参数不是普通对象时使用 `{}`。
3. 使用 MCP 原始工具名调用：
   ```ts
   {
     name: tool.rawName,
     arguments,
   }
   ```
4. 传递 Harness 的 `AbortSignal`。
5. 传递配置中的 timeout。
6. `result.content` 是数组时原样保留。
7. `result.content` 不是数组时生成备用文本。
8. `result.isError === true` 时抛出包含文本结果的错误。
9. 返回 `content` 和可选的 `structuredContent`。

备用文本：

- `toolResult` 存在：`JSON.stringify(toolResult)`。
- 否则：`(no output)`。

### 9.4 模型文本渲染

内容块转换：

| MCP block type | Harness 文本 |
|---|---|
| `text` | 原始 `text` |
| `image` | `[image: <mimeType>]` |
| `audio` | `[audio: <mimeType>]` |
| `resource` | `[resource]` |
| `resource_link` | `[resource]` |
| 其他 | `[unsupported content type: <type>]` |

多个内容块用换行连接；没有文本内容时使用 `(<rawName> returned no text content)`。

### 9.5 持久化 App metadata

有 `resourceUri` 的工具会在 presentation metadata 中写入：

```ts
{
  mcpApp: {
    serverName,
    rawToolName,
    resourceUri,
    result,
  },
}
```

这里的 `result` 是服务器返回的原始 JSON-safe `CallToolResult`，包括 `structuredContent`。Client 依靠 `rawToolName` 和 `resourceUri` 匹配正确的 App View。

不包含 MCP URL、命令、headers、env 或凭据。

## 10. Host RPC

实现文件：[src/rpc.ts](../src/rpc.ts)

注册：

```ts
ctx.connection.rpc.handle(
  '/mcp-apps',
  handler,
  { authority: 'loopback' },
)
```

### 10.1 输入校验

`resources/read`：

```ts
z.object({
  uri: z.string().startsWith('ui://'),
}).strict()
```

`tools/call`：

```ts
z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
}).strict()
```

### 10.2 Endpoint

| Endpoint | 行为 |
|---|---|
| `tools/list-ui` | 返回模型可见且带 `resourceUri` 的工具 |
| `resources/read` | 读取并校验 MCP App HTML |
| `tools/call` | 只允许调用 `appVisible` 工具 |
| `tools/list` | 返回所有 `appVisible` 工具的原始 MCP 定义 |
| `resources/list` | 代理 MCP `resources/list` |
| `ping` | 返回 `{}` |

`tools/list-ui` 返回：

```ts
[
  {
    publicName,
    rawName,
    resourceUri,
  },
]
```

`tools/call` 使用 raw MCP tool name 查找 descriptor：

```text
工具不存在              -> bad-request
工具不是 appVisible      -> bad-request
工具存在且可见           -> client.callTool
```

任何异常统一转换为：

```ts
{
  ok: false,
  error: {
    code: 'bad-request',
    message,
    details: {
      issues: [],
    },
  },
}
```

未知 endpoint 也使用该错误结构。

## 11. Web Client 插件入口

实现文件：[src/client/index.tsx](../src/client/index.tsx)

入口声明：

```ts
export const inject = ['connection', 'slots']
```

激活流程：

1. 调用：
   ```ts
   connection.rpc.call('/mcp-apps', 'tools/list-ui', null)
   ```
2. RPC 失败时直接抛错，阻止 Client 激活。
3. 返回值不是数组时抛错。
4. 校验每个元素：
   - 普通对象。
   - `publicName` 是字符串。
   - `rawName` 是字符串。
   - `resourceUri` 是以 `ui://` 开头的字符串。
5. 每个 UI 工具注册一个 keyed `tool.call.toolview` slot。
6. key 使用 `publicName`。
7. fiber 销毁时自动移除对应 slot。

注册组件接收：

```ts
{
  ...ToolCallOwnerProps,
  tool,
  connection,
}
```

## 12. MCP App Tool View

实现文件：[src/client/McpAppToolView.tsx](../src/client/McpAppToolView.tsx)

### 12.1 恢复已结算调用

View 首先从 Harness `ToolCallBlock` 恢复调用。

必须同时满足：

1. block 包含 `kind` 字段。
2. `block.call` 不为 `null`。
3. `block.meta.mcpApp` 是普通对象。
4. metadata 的 `rawToolName` 等于当前工具的 `rawName`。
5. metadata 的 `resourceUri` 等于当前工具的 `resourceUri`。
6. metadata 的 `result` 是对象，且 `result.content` 是数组。
7. `block.call.argsRaw` 能解析为非数组 JSON 对象。

不满足时返回 `null`，View 显示等待状态。

恢复后的结构：

```ts
{
  arguments,
  result,
  resourceUri,
}
```

### 12.2 View 状态

```text
call 无法恢复
  -> Waiting for MCP App result…

正在读取资源
  -> Loading MCP App…

资源或 Bridge 失败
  -> role="alert" 错误文本

资源加载成功
  -> 工具名标题 + iframe
```

### 12.3 读取资源

```ts
connection.rpc.call(
  '/mcp-apps',
  'resources/read',
  { uri: call.resourceUri },
  controller.signal,
)
```

Client 额外校验返回值：

- 必须是对象。
- `resource.uri` 必须等于请求 URI。
- `resource.html` 必须是字符串。

资源 effect 由 `AbortController` 管理；组件卸载时 abort。已 abort 的请求错误不会写入 View error state。

## 13. iframe 和 CSP

HTML 使用 `iframe.srcDoc` 注入，不直接导航到 `ui://` 地址。

固定 iframe 属性：

```html
<iframe
  sandbox="allow-scripts allow-forms allow-downloads"
  allow="..."
  srcdoc="..."
/>
```

明确不包含：

```text
allow-same-origin
```

Permission Policy：

```ts
buildAllowAttribute(resource.permissions)
```

CSP 由资源 metadata 生成并插入 HTML：

```text
default-src 'none'
script-src 'unsafe-inline' <resourceDomains>
style-src 'unsafe-inline' <resourceDomains>
img-src data: blob: <resourceDomains>
font-src data: <resourceDomains>
media-src data: blob: <resourceDomains>
connect-src <connectDomains 或 'none'>
frame-src <frameDomains 或 'none'>
base-uri <baseUriDomains 或 'none'>
form-action 'none'
```

注入规则：

- 有 `<head>`：插入到 `<head>` 开始标签之后。
- 没有 `<head>`：直接放在 HTML 前面。
- 仅转义 `&` 和 `"`。

高度：

- 初始高度：`360`。
- 只接受有限数字。
- 四舍五入为整数。
- 限制在 `160..800` 像素。

## 14. AppBridge

实现文件：[src/client/bridge.ts](../src/client/bridge.ts)

创建 Bridge：

```ts
new AppBridge(
  null,
  {
    name: 'DeepSeek Harness',
    version: '0.1.0',
  },
  {
    serverTools: {},
    serverResources: {},
  },
)
```

传入 `null`，因此使用手动 handler，而不是 SDK 自动连接 MCP Client。

App 请求映射：

```text
tools/call       -> /mcp-apps/tools/call
resources/list   -> /mcp-apps/resources/list
resources/read   -> /mcp-apps/resources/read
```

AppBridge 的 abort signal 继续传给 Harness RPC，再传给 Host MCP Client。

Transport：

```ts
new PostMessageTransport(
  iframe.contentWindow,
  iframe.contentWindow,
)
```

初始化顺序必须是：

```text
iframe View
  │
  ├── bridge.connect()
  ├── View 发送 initialized
  ├── Host 收到 initialized
  ├── bridge.sendToolInput({ arguments })
  └── bridge.sendToolResult(originalCallToolResult)
```

必须先发送 tool input，再发送 tool result。

销毁：

```ts
bridge.teardownResource({})
```

销毁是 best-effort，teardown 错误被忽略；没有显式调用 `bridge.close()`。

AppBridge 当前没有声明或实现：

- prompts
- sampling
- openLink
- downloads
- model context update
- display mode
- logging

## 15. 安全边界

不可信输入：

- MCP Server 网络或子进程输出。
- MCP Server 返回的 App HTML。
- 模型生成的工具参数。
- 浏览器发来的 RPC JSON。

安全控制：

- MCP URL、命令、headers、env 和凭据只在 Host。
- RPC channel 使用 `authority: 'loopback'`。
- RPC payload 在进入 MCP SDK 前经过 Zod 校验。
- iframe 不授予 `allow-same-origin`。
- sandbox 只允许 scripts、forms、downloads。
- 默认 CSP 禁止网络、嵌套 frame、base URI 和表单提交。
- Permission Policy 只开放资源 metadata 明确声明的权限。
- App 只能调用同一 MCP Server 且 `appVisible` 的工具。
- 工具结果 metadata 不包含连接配置和凭据。
- 凭据不写日志、不返回浏览器、不提交 Git。

官方 `PostMessageTransport` 会校验消息来源的 `event.source` 是否为当前 iframe window。底层发送使用 `postMessage(..., '*')`，项目自身没有额外的 origin allowlist。

## 16. 构建和发布

实现文件：[tsdown.config.ts](../tsdown.config.ts)、[package.json](../package.json)

### 16.1 Host bundle

```text
src/index.ts
  -> lib/index.js
  -> ESM
```

### 16.2 Client bundle

```text
src/client/index.tsx
  -> lib/client.js
  -> CommonJS
  -> browser platform
  -> window.__ModuleLoader__.load(...)
```

Client 构建规则：

- React 和 `react/jsx-runtime` 外部化，复用 Harness shell。
- Cordis、DSH UI slot 等宿主依赖外部化。
- MCP Apps runtime 打进 `client.js`。
- 使用 source map。
- 使用自定义 banner/footer，把 CommonJS 工厂交给 DSH ModuleLoader。

### 16.3 npm 文件和 exports

Host：

```text
.
  types: ./lib/types/index.d.ts
  default: ./lib/index.js
```

Client：

```text
./client
  types: ./lib/types/client/index.d.ts
  default: ./lib/client.js
```

发布内容包括：

- `lib/index.js`
- `lib/client.js`
- `lib/types/**/*.d.ts`
- `lib/types/**/*.d.ts.map`
- `cordis.patch.yml`
- `README.md`
- `LICENSE`

### 16.4 验证命令

```sh
npm ci
npm test
npm run typecheck
npm run build
```

GitHub Release workflow 还会：

1. 校验 release tag 与 package version 一致。
2. 安装依赖。
3. 运行测试、类型检查和构建。
4. 执行 `npm pack`。
5. 上传 GitHub Actions artifact。
6. 把 tarball 附加到 GitHub Release。
7. 如果相同 npm 版本不存在，则使用 Trusted Publishing 发布到 npm。

## 17. 测试规格

### `tests/config.spec.ts`

覆盖：

- stdio 默认值。
- Streamable HTTP 配置。
- `serverName` 非法输入。
- 严格删除另一 transport 的字段。

### `tests/protocol.spec.ts`

覆盖：

- `tools/list` 分页。
- 嵌套和 legacy UI metadata。
- app-only 可见性。
- 非法 UI URI。
- 文本和 Base64 blob HTML。
- content metadata 优先级。
- listing metadata fallback。
- 内容数量和 MIME 校验。
- App identity metadata。

### `tests/tools.spec.ts`

覆盖：

- 模型可见工具注册。
- public name。
- output schema。
- `structuredContent` 保留。
- `isError` 映射。
- 模型文本渲染。
- App presentation metadata。

### `tests/rpc.spec.ts`

覆盖：

- UI 工具列表。
- 资源读取。
- App-visible 工具调用。
- 非法 payload。
- 未知 endpoint。

### `tests/plugin.spec.ts`

覆盖：

- Cordis 激活。
- 工具注册。
- loopback RPC 注册。
- fiber 销毁。
- strict/non-strict 启动失败。

### `tests/client-plugin.client.spec.tsx`

覆盖：

- `tools/list-ui` 发现。
- keyed slot 注册。
- fiber 销毁清理。
- Host discovery 失败阻止激活。

### `tests/app-view.client.spec.tsx`

覆盖：

- settled metadata 匹配。
- 参数 JSON 解析。
- 资源 RPC 调用。
- iframe sandbox 属性。
- Permission Policy 属性。
- iframe HTML 装载。
- 资源读取错误。

### `tests/integration.spec.ts`

启动真实 stdio fixture，验证：

- MCP Client 连接。
- 工具发现。
- 工具调用。
- `structuredContent`。
- `ui://` HTML 资源读取。
- 连接关闭。

### `tests/client-bundle-config.spec.ts`

覆盖：

- CJS ModuleLoader 工厂包装。
- React external。
- MCP Apps runtime 打包。
- Host/Client declaration exports。
- bundle patch 文件和默认 VibeFun URL。

当前测试未直接覆盖：

- `bridge.ts` 的完整 postMessage 握手。
- input/result 推送顺序。
- CSP 字符串生成。
- Abort cleanup。
- View 高度夹取。
- bridge teardown。
- PostMessageTransport 的消息 source 校验。

## 18. 当前限制

- 一个插件实例只连接一个 MCP Server。
- 多个 Server 需要挂载多个插件实例。
- UI 工具发现只发生在 Client 插件激活时。
- Server 修改工具列表后，需要刷新 Client 或重新加载插件。
- 不支持 prompts、sampling、downloads、external-link opening 和 model-context updates。
- App HTML 使用 `srcdoc`，远程资源必须通过 CSP metadata 声明。
- Web Client 支持 iframe App，Headless 和 ACP 只获得原生工具。
- 没有 UI 的 MCP 工具仍作为普通 Harness 工具运行。

## 19. 复刻实现顺序

建议按以下顺序实现：

1. 建立 TypeScript ESM npm 包。
2. 实现配置 schema 和配置测试。
3. 实现协议层：工具发现、分页、UI metadata、可见性、public name、资源读取。
4. 实现 MCP 连接：SDK Client、MCP Apps capability、stdio、HTTP。
5. 实现 Harness Tool 转换：参数、结果、schema、文本投影、metadata。
6. 实现 Cordis Host 入口和资源清理。
7. 实现 loopback RPC 和 Zod payload 校验。
8. 实现 Client 入口和 keyed `tool.call.toolview` 注册。
9. 实现 settled metadata 恢复、资源加载和 iframe。
10. 实现 CSP、Permission Policy 和 AppBridge。
11. 添加真实 stdio fixture 和集成测试。
12. 配置 Host/Client 双 bundle 构建。
13. 添加 bundle patch、README 和安全说明。
14. 执行完整测试、类型检查和构建。

## 20. 当前代码与历史计划的差异

历史计划中出现但当前源码没有实现的功能：

- `prompts/list` 和 `prompts/get` RPC。
- 独立 sandbox proxy 页面。
- `openLink`。
- `requestDisplayMode`。
- downloads。
- logging。
- model-context updates。

如果目标是复刻当前版本，应以本规格、`src/` 和 `tests/` 为准，不应把这些历史计划内容加入实现。
