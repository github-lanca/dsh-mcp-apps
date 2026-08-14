import { assertSupportedJsonSchema, type JsonSchemaNode, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AppToolDescriptor } from './protocol.ts'
import { appPresentationMeta } from './protocol.ts'

export interface ToolCallingClient {
  callTool(
    request: { name: string; arguments: Record<string, unknown> },
    options: { signal: AbortSignal; timeout: number },
  ): Promise<CallToolResult>
}

interface CallToolResult {
  content?: unknown[]
  structuredContent?: unknown
  toolResult?: unknown
  isError?: boolean
}

interface McpContentBlock {
  type?: unknown
  text?: unknown
  mimeType?: unknown
}

export function createToolDefinitions(
  client: ToolCallingClient,
  descriptors: readonly AppToolDescriptor[],
  serverName: string,
  toolCallTimeoutMs: number,
): ToolDefinition[] {
  return descriptors
    .filter(tool => tool.modelVisible)
    .map(tool => ({
      name: tool.publicName,
      description: tool.description ?? '',
      parameters: tool.inputSchema,
      timeoutMs: toolCallTimeoutMs,
      output: {
        schema: {
          type: 'object',
          properties: {
            content: { type: 'array', items: {} },
            structuredContent: supportedOutputSchema(tool.outputSchema) ?? {},
          },
          required: ['content'],
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: extractText((value as { content: unknown[] }).content, tool.rawName),
        }],
        presentationMeta: (_args, value) => appPresentationMeta(tool, serverName, value) ?? {},
      },
      async execute(args, exec) {
        const argumentsValue = typeof args === 'object' && args !== null && !Array.isArray(args)
          ? args as Record<string, unknown>
          : {}
        const result = await client.callTool(
          { name: tool.rawName, arguments: argumentsValue },
          { signal: exec.signal, timeout: toolCallTimeoutMs },
        )
        const content = Array.isArray(result.content)
          ? result.content
          : [{ type: 'text', text: result.toolResult === undefined ? '(no output)' : JSON.stringify(result.toolResult) }]
        if (result.isError === true) throw new Error(extractText(content, tool.rawName))
        return {
          content,
          ...result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent },
        }
      },
    })) as ToolDefinition[]
}

// MCP accepts the full JSON Schema vocabulary, while Harness intentionally
// validates a smaller model-facing subset. Preserve supported contracts and
// keep unsupported structured results as JSON values instead of preventing
// the entire MCP Server from loading.
function supportedOutputSchema(candidate: unknown): JsonSchemaNode | undefined {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate as JsonSchemaNode
  } catch {
    return undefined
  }
}

function extractText(content: readonly unknown[], rawName: string): string {
  const parts: string[] = []
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      parts.push('[unsupported content type: unknown]')
      continue
    }
    const block = value as McpContentBlock
    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string') parts.push(block.text)
        break
      case 'image':
        parts.push(`[image: ${typeof block.mimeType === 'string' ? block.mimeType : 'unknown'}]`)
        break
      case 'audio':
        parts.push(`[audio: ${typeof block.mimeType === 'string' ? block.mimeType : 'unknown'}]`)
        break
      case 'resource':
      case 'resource_link':
        parts.push('[resource]')
        break
      default:
        parts.push(`[unsupported content type: ${String(block.type ?? 'unknown')}]`)
    }
  }
  return parts.join('\n') || `(${rawName} returned no text content)`
}
