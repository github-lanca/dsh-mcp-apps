import { createHash } from 'node:crypto'
import {
  getToolUiResourceUri,
  isToolVisibilityAppOnly,
  isToolVisibilityModelOnly,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/app-bridge'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export type McpUiResourceCsp = Record<string, unknown>
export type McpUiResourcePermissions = Record<string, Record<string, never>>

export interface McpClientLike {
  listTools(params?: { cursor?: string }): Promise<{ tools: Tool[]; nextCursor?: string }>
  listResources(params?: { cursor?: string }): Promise<{ resources: ResourceListing[]; nextCursor?: string }>
  readResource(params: { uri: string }): Promise<{ contents: ResourceContent[] }>
}

interface ResourceListing {
  uri: string
  _meta?: Record<string, unknown>
}

interface ResourceContent {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
  _meta?: Record<string, unknown>
  meta?: Record<string, unknown>
}

export interface AppToolDescriptor {
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

export interface AppResourcePayload {
  uri: string
  html: string
  csp?: McpUiResourceCsp
  permissions?: McpUiResourcePermissions
}

const MAX_PUBLIC_NAME_LENGTH = 64
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g
const HASH_LENGTH = 12

export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

export async function discoverTools(client: McpClientLike, serverName: string): Promise<AppToolDescriptor[]> {
  const descriptors: AppToolDescriptor[] = []
  const names = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor === undefined ? undefined : { cursor })
    for (const tool of page.tools) {
      if (names.has(tool.name)) throw new Error(`MCP server listed tool ${JSON.stringify(tool.name)} more than once`)
      names.add(tool.name)
      const resourceUri = getToolUiResourceUri(tool)
      descriptors.push({
        rawName: tool.name,
        publicName: publicToolName(serverName, tool.name),
        inputSchema: tool.inputSchema,
        ...tool.description === undefined ? {} : { description: tool.description },
        ...tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema },
        ...resourceUri === undefined ? {} : { resourceUri },
        modelVisible: !isToolVisibilityAppOnly(tool),
        appVisible: !isToolVisibilityModelOnly(tool),
        raw: tool,
      })
    }
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return descriptors
}

export function appPresentationMeta(
  tool: AppToolDescriptor,
  serverName: string,
  result?: unknown,
): Record<string, unknown> | undefined {
  if (tool.resourceUri === undefined) return undefined
  return {
    mcpApp: {
      serverName,
      rawToolName: tool.rawName,
      resourceUri: tool.resourceUri,
      ...result === undefined ? {} : { result },
    },
  }
}

export async function readAppResource(client: McpClientLike, uri: string): Promise<AppResourcePayload> {
  const listings = new Map<string, ResourceListing>()
  let cursor: string | undefined
  do {
    const page = await client.listResources(cursor === undefined ? undefined : { cursor })
    for (const resource of page.resources) listings.set(resource.uri, resource)
    cursor = page.nextCursor
  } while (cursor !== undefined)

  const response = await client.readResource({ uri })
  if (response.contents.length !== 1) {
    throw new Error(`MCP App resource ${JSON.stringify(uri)} must return exactly one content item`)
  }
  const content = response.contents[0]!
  if (content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Unsupported MCP App MIME type ${JSON.stringify(content.mimeType)} for ${JSON.stringify(uri)}`)
  }
  const html = content.text ?? decodeBase64(content.blob)
  if (html === undefined) throw new Error(`MCP App resource ${JSON.stringify(uri)} returned neither text nor blob HTML`)

  const contentMeta = content._meta ?? content.meta
  const listingMeta = listings.get(uri)?._meta
  const contentUi = readUiMeta(contentMeta)
  const listingUi = readUiMeta(listingMeta)
  const csp = contentUi?.csp ?? listingUi?.csp
  const permissions = contentUi?.permissions ?? listingUi?.permissions
  return {
    uri,
    html,
    ...csp === undefined ? {} : { csp },
    ...permissions === undefined ? {} : { permissions },
  }
}

function readUiMeta(meta: Record<string, unknown> | undefined): {
  csp?: McpUiResourceCsp
  permissions?: McpUiResourcePermissions
} | undefined {
  const ui = meta?.ui
  if (typeof ui !== 'object' || ui === null || Array.isArray(ui)) return undefined
  return ui as { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions }
}

function decodeBase64(blob: string | undefined): string | undefined {
  if (blob === undefined) return undefined
  return Buffer.from(blob, 'base64').toString('utf8')
}
