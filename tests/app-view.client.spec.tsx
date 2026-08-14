// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpAppToolView, resolveSettledAppCall } from '../src/client/McpAppToolView.tsx'

afterEach(cleanup)

const tool = {
  publicName: 'mcp__vibefun__chart',
  rawName: 'chart',
  resourceUri: 'ui://vibefun/chart',
}

const settled = {
  kind: 'tool-result' as const,
  seq: 2,
  time: 2,
  callId: 'call-1',
  call: { name: tool.publicName, argsRaw: '{"topic":"MCP"}' },
  callTime: 1,
  content: [{ type: 'text' as const, text: 'done' }],
  isError: false,
  meta: {
    mcpApp: {
      serverName: 'vibefun',
      rawToolName: 'chart',
      resourceUri: 'ui://vibefun/chart',
      result: { content: [{ type: 'text', text: 'done' }] },
    },
  },
  callView: null,
  resultView: null,
  subCalls: [],
}

describe('MCP App tool view', () => {
  it('accepts only settled calls whose durable metadata matches the registered tool', () => {
    expect(resolveSettledAppCall(settled, tool)).toEqual({
      arguments: { topic: 'MCP' },
      result: { content: [{ type: 'text', text: 'done' }] },
      resourceUri: 'ui://vibefun/chart',
    })
    expect(resolveSettledAppCall({ ...settled, meta: undefined }, tool)).toBeNull()
    expect(resolveSettledAppCall({ ...settled, call: { ...settled.call!, argsRaw: 'not json' } }, tool)).toBeNull()
  })

  it('loads HTML through Host RPC and creates a script-only sandboxed iframe', async () => {
    const call = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        uri: 'ui://vibefun/chart',
        html: '<main id="app">VibeFun chart</main>',
        permissions: { clipboardWrite: {} },
      },
    })
    const connection = { rpc: { call } }

    const { container } = render(<McpAppToolView
      tool={tool}
      connection={connection as never}
      callId="call-1"
      toolName={tool.publicName}
      block={settled}
      openFile={() => undefined}
    />)

    expect(screen.getByText('Loading MCP App…')).toBeTruthy()
    await waitFor(() => expect(call).toHaveBeenCalledWith(
      '/mcp-apps',
      'resources/read',
      { uri: 'ui://vibefun/chart' },
      expect.any(AbortSignal),
    ))
    const iframe = await waitFor(() => container.querySelector('iframe'))
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-downloads')
    expect(iframe!.getAttribute('allow')).toBe('clipboard-write')
    expect(iframe!.getAttribute('srcdoc')).toContain('VibeFun chart')
  })

  it('shows a contained error when Host resource loading fails', async () => {
    const connection = {
      rpc: {
        call: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'bad-request', message: 'unsupported MIME', details: { issues: [] } },
        }),
      },
    }
    render(<McpAppToolView
      tool={tool}
      connection={connection as never}
      callId="call-1"
      toolName={tool.publicName}
      block={settled}
      openFile={() => undefined}
    />)

    expect(await screen.findByText('unsupported MIME')).toBeTruthy()
  })
})
