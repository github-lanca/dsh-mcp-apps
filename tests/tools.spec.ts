import { describe, expect, it, vi } from 'vitest'
import { createToolDefinitions } from '../src/tools.ts'
import type { AppToolDescriptor } from '../src/protocol.ts'

function descriptor(overrides: Partial<AppToolDescriptor> = {}): AppToolDescriptor {
  return {
    rawName: 'chart',
    publicName: 'mcp__vibefun__chart',
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string' } },
      required: ['topic'],
    },
    description: 'Draw a chart',
    resourceUri: 'ui://vibefun/chart',
    modelVisible: true,
    appVisible: true,
    raw: { name: 'chart', inputSchema: { type: 'object' } },
    ...overrides,
  }
}

describe('Harness MCP tool definitions', () => {
  it('registers only model-visible tools with the MCP schema and public name', () => {
    const definitions = createToolDefinitions({ callTool: vi.fn() }, [
      descriptor(),
      descriptor({ rawName: 'refresh', publicName: 'mcp__vibefun__refresh', modelVisible: false }),
    ], 'vibefun', 12_345)

    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toMatchObject({
      name: 'mcp__vibefun__chart',
      description: 'Draw a chart',
      parameters: descriptor().inputSchema,
      timeoutMs: 12_345,
    })
  })

  it('falls back to untyped structured content when MCP advertises unsupported schema vocabulary', () => {
    const [definition] = createToolDefinitions({ callTool: vi.fn() }, [descriptor({
      outputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { values: { type: 'array', items: { type: 'number' } } },
      },
    })], 'vibefun', 60_000)

    const schema = definition!.output.schema as { properties: { structuredContent: unknown } }
    expect(schema.properties.structuredContent).toEqual({})
  })

  it('calls the raw MCP tool and preserves content and structuredContent', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'done' }],
      structuredContent: { series: [1, 2, 3] },
    })
    const [definition] = createToolDefinitions({ callTool }, [descriptor()], 'vibefun', 60_000)
    const signal = new AbortController().signal

    await expect(definition!.execute({ topic: 'MCP' }, { signal } as never)).resolves.toEqual({
      content: [{ type: 'text', text: 'done' }],
      structuredContent: { series: [1, 2, 3] },
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'chart', arguments: { topic: 'MCP' } },
      { signal, timeout: 60_000 },
    )
  })

  it('maps MCP isError to a rejected Harness execution', async () => {
    const [definition] = createToolDefinitions({
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'bad input' }], isError: true }),
    }, [descriptor()], 'vibefun', 60_000)

    await expect(definition!.execute({}, { signal: new AbortController().signal } as never)).rejects.toThrow('bad input')
  })

  it('renders text for the model while preserving App identity in presentation metadata', () => {
    const [definition] = createToolDefinitions({ callTool: vi.fn() }, [descriptor()], 'vibefun', 60_000)
    const value = {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', mimeType: 'image/png', data: 'discarded-from-model-projection' },
      ],
    }

    expect(definition!.output.render({}, value)).toEqual([
      { type: 'text', text: 'hello\n[image: image/png]' },
    ])
    expect(definition!.output.presentationMeta?.({}, value)).toEqual({
      mcpApp: {
        serverName: 'vibefun',
        rawToolName: 'chart',
        resourceUri: 'ui://vibefun/chart',
        result: value,
      },
    })
  })
})
