import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appendSwitch: vi.fn(),
  handle: vi.fn(),
  registerSchemesAsPrivileged: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { commandLine: { appendSwitch: mocks.appendSwitch }, isPackaged: true },
  net: { fetch: vi.fn() },
  protocol: {
    handle: mocks.handle,
    registerSchemesAsPrivileged: mocks.registerSchemesAsPrivileged,
  },
}))

import {
  configureInlineVisualizationProcessIsolation,
  registerRendererScheme,
} from '../../../renderer-protocol'
import { electronTrustedOrigins } from '../electron-trusted-origins'

const SECURE_FETCH = { standard: true, secure: true, supportFetchAPI: true }

beforeEach(() => {
  mocks.appendSwitch.mockClear()
  mocks.handle.mockClear()
  mocks.registerSchemesAsPrivileged.mockClear()
})

describe('Electron trusted origins', () => {
  it('declares the six app schemes with the privileges Electron registered before the port', () => {
    registerRendererScheme()

    expect(mocks.registerSchemesAsPrivileged).toHaveBeenCalledExactlyOnceWith([
      { scheme: 'openwaggle', privileges: { ...SECURE_FETCH, corsEnabled: true, codeCache: true } },
      {
        scheme: 'openwaggle-extension',
        privileges: { ...SECURE_FETCH, corsEnabled: true, codeCache: true },
      },
      {
        scheme: 'openwaggle-extension-frame',
        privileges: { ...SECURE_FETCH, corsEnabled: true, codeCache: true },
      },
      { scheme: 'openwaggle-visualization', privileges: { ...SECURE_FETCH, corsEnabled: false } },
      { scheme: 'openwaggle-mcp-app', privileges: { ...SECURE_FETCH, corsEnabled: false } },
      {
        scheme: 'openwaggle-session-resource',
        privileges: { ...SECURE_FETCH, corsEnabled: false },
      },
    ])
  })

  it('serves a domain on its scheme and addresses its hosts there', () => {
    const handler = () => new Response(null)
    electronTrustedOrigins.serve('mcp-app-frame', handler)

    expect(mocks.handle).toHaveBeenCalledExactlyOnceWith('openwaggle-mcp-app', handler)
    expect(electronTrustedOrigins.originOf('renderer', 'app')).toBe('openwaggle://app')
  })

  it('isolates every site in its own renderer process', () => {
    configureInlineVisualizationProcessIsolation()

    expect(mocks.appendSwitch).toHaveBeenCalledExactlyOnceWith('site-per-process')
  })
})
