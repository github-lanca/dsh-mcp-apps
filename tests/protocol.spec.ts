import { describe, expect, it } from 'vitest'
import {
  appPresentationMeta,
  discoverTools,
  readAppResource,
  type McpClientLike,
} from '../src/protocol.ts'

function client(options: {
  pages?: Record<string, { tools: unknown[]; nextCursor?: string }>
  resource?: unknown
  listings?: unknown[]
}): McpClientLike {
  return {
    async listTools(params) {
      return options.pages?.[params?.cursor ?? 'first'] ?? { tools: [] }
    },
    async listResources() {
      return { resources: options.listings ?? [] }
    },
    async readResource() {
      return options.resource as never
    },
  }
}

describe('MCP Apps protocol helpers', () => {
  it('discovers paginated tools and projects nested and legacy UI metadata', async () => {
    const tools = await discoverTools(client({
      pages: {
        first: {
          tools: [
            { name: 'chart', inputSchema: { type: 'object' }, _meta: { ui: { resourceUri: 'ui://vibefun/chart' } } },
            { name: 'plain', inputSchema: { type: 'object' } },
          ],
          nextCursor: 'p2',
        },
        p2: {
          tools: [
            { name: 'legacy', inputSchema: { type: 'object' }, _meta: { 'ui/resourceUri': 'ui://vibefun/legacy' } },
          ],
        },
      },
    }), 'vibefun')

    expect(tools.map(tool => [tool.rawName, tool.publicName, tool.resourceUri])).toEqual([
      ['chart', 'mcp__vibefun__chart', 'ui://vibefun/chart'],
      ['plain', 'mcp__vibefun__plain', undefined],
      ['legacy', 'mcp__vibefun__legacy', 'ui://vibefun/legacy'],
    ])
  })

  it('keeps app-only tools available to Views but hides them from the model', async () => {
    const tools = await discoverTools(client({
      pages: {
        first: {
          tools: [{
            name: 'refresh',
            inputSchema: { type: 'object' },
            _meta: { ui: { resourceUri: 'ui://vibefun/app', visibility: ['app'] } },
          }],
        },
      },
    }), 'vibefun')

    expect(tools[0]).toMatchObject({ modelVisible: false, appVisible: true })
  })

  it('rejects malformed UI resource URIs during discovery', async () => {
    await expect(discoverTools(client({
      pages: {
        first: { tools: [{ name: 'bad', inputSchema: {}, _meta: { ui: { resourceUri: 'https://evil.test/app' } } }] },
      },
    }), 'vibefun')).rejects.toThrow('Invalid UI resource URI')
  })

  it('reads one HTML app resource and prefers content metadata', async () => {
    const result = await readAppResource(client({
      listings: [{
        uri: 'ui://vibefun/chart',
        _meta: { ui: { csp: { connectDomains: ['https://listing.test'] } } },
      }],
      resource: {
        contents: [{
          uri: 'ui://vibefun/chart',
          mimeType: 'text/html;profile=mcp-app',
          text: '<main>chart</main>',
          _meta: {
            ui: {
              csp: { connectDomains: ['https://content.test'] },
              permissions: { clipboardWrite: {} },
            },
          },
        }],
      },
    }), 'ui://vibefun/chart')

    expect(result).toEqual({
      uri: 'ui://vibefun/chart',
      html: '<main>chart</main>',
      csp: { connectDomains: ['https://content.test'] },
      permissions: { clipboardWrite: {} },
    })
  })

  it('decodes blob HTML and falls back to listing metadata', async () => {
    const result = await readAppResource(client({
      listings: [{
        uri: 'ui://vibefun/blob',
        _meta: { ui: { permissions: { microphone: {} } } },
      }],
      resource: {
        contents: [{
          uri: 'ui://vibefun/blob',
          mimeType: 'text/html;profile=mcp-app',
          blob: Buffer.from('<main>blob</main>').toString('base64'),
        }],
      },
    }), 'ui://vibefun/blob')

    expect(result.html).toBe('<main>blob</main>')
    expect(result.permissions).toEqual({ microphone: {} })
  })

  it('rejects multiple contents and non-App MIME types', async () => {
    await expect(readAppResource(client({ resource: { contents: [] } }), 'ui://x')).rejects.toThrow('exactly one')
    await expect(readAppResource(client({
      resource: { contents: [{ uri: 'ui://x', mimeType: 'text/html', text: 'x' }] },
    }), 'ui://x')).rejects.toThrow('Unsupported MCP App MIME type')
  })

  it('projects only durable App identity into Harness result metadata', () => {
    expect(appPresentationMeta({
      rawName: 'chart',
      publicName: 'mcp__vibefun__chart',
      inputSchema: {},
      modelVisible: true,
      appVisible: true,
      resourceUri: 'ui://vibefun/chart',
      raw: { name: 'chart', inputSchema: {} },
    }, 'vibefun')).toEqual({
      mcpApp: {
        serverName: 'vibefun',
        rawToolName: 'chart',
        resourceUri: 'ui://vibefun/chart',
      },
    })
  })
})
