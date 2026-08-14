import { describe, expect, it } from 'vitest'
import manifest from '../package.json'
import { clientBundleConfig } from '../tsdown.config.ts'

describe('DSH web client bundle', () => {
  it('registers a lazy CommonJS factory with the Harness module loader', () => {
    expect(clientBundleConfig.format).toBe('cjs')
    expect(clientBundleConfig.outputOptions).toMatchObject({
      entryFileNames: 'client.js',
      banner: expect.stringContaining('window.__ModuleLoader__.load'),
      footer: expect.stringContaining('return module.exports'),
      intro: expect.stringContaining('module = { exports: {} }'),
    })
  })

  it('shares React with the Harness shell and bundles MCP Apps runtime code', () => {
    expect(clientBundleConfig.external).toEqual(expect.arrayContaining([
      'react',
      'react/jsx-runtime',
    ]))
    expect(clientBundleConfig.noExternal?.('@modelcontextprotocol/ext-apps/app-bridge')).toBe(true)
  })

  it('publishes generated declarations for both Host and Client faces', () => {
    expect(manifest.exports['.'].types).toBe('./lib/types/index.d.ts')
    expect(manifest.exports['./client'].types).toBe('./lib/types/client/index.d.ts')
    expect(manifest.files).toContain('lib/types/**/*.d.ts')
  })
})
