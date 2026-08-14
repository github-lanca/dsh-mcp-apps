import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const uri = 'ui://fixture/chart'
const server = new McpServer({ name: 'dsh-mcp-apps-fixture', version: '1.0.0' })

registerAppTool(server, 'make_chart', {
  title: 'Make Chart',
  description: 'Build a chart from numeric values.',
  inputSchema: { values: z.array(z.number()) },
  outputSchema: z.object({ values: z.array(z.number()) }),
  _meta: { ui: { resourceUri: uri } },
}, async ({ values }) => ({
  content: [{ type: 'text', text: 'Chart ready' }],
  structuredContent: { values },
}))

registerAppResource(server, uri, uri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
  contents: [{
    uri,
    mimeType: RESOURCE_MIME_TYPE,
    text: '<!doctype html><html><body><main>Fixture Chart</main></body></html>',
  }],
}))

await server.connect(new StdioServerTransport())
