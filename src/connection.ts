import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { McpServerConfig } from './config.ts'
import type { ConnectedMcpClient } from './index.ts'

const IMPLEMENTATION = { name: '@sugarforever/dsh-mcp-apps', version: '0.1.0' }

export async function createMcpClient(config: McpServerConfig): Promise<ConnectedMcpClient> {
  const client = new Client(IMPLEMENTATION, {
    capabilities: {
      extensions: {
        'io.modelcontextprotocol/ui': {
          mimeTypes: [RESOURCE_MIME_TYPE],
        },
      },
    },
  })
  if (config.transport === 'stdio' && config.command === '') {
    throw new Error(`mcp-apps(${config.serverName}): stdio transport requires a command`)
  }
  if (config.transport === 'streamable-http' && config.url === '') {
    throw new Error(`mcp-apps(${config.serverName}): streamable-http transport requires a url`)
  }

  const transport = config.transport === 'stdio'
    ? new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...getDefaultEnvironment(), ...config.env },
        ...config.cwd === '' ? {} : { cwd: config.cwd },
      })
    : new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      })

  try {
    await client.connect(transport)
  } catch (error) {
    await transport.close().catch(() => undefined)
    throw error
  }

  return {
    client: {
      listTools: params => client.listTools(params),
      listResources: params => client.listResources(params),
      readResource: params => client.readResource(params),
      callTool: (request, options) => client.callTool(request, undefined, options),
    },
    close: () => client.close(),
  }
}
