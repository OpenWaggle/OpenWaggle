import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION_FRAME_PROTOCOL } from '@shared/constants/extension-frame'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HTTP_OK_STATUS = 200
const HTTP_NOT_FOUND_STATUS = 404

interface ProtocolRequest {
  readonly url: string
}

type ProtocolHandler = (request: ProtocolRequest) => Response | Promise<Response>

const protocolMocks = vi.hoisted(() => {
  const protocolHandlers = new Map<string, ProtocolHandler>()
  return {
    is: { dev: false },
    env: { ELECTRON_RENDERER_URL: '' },
    app: { getPath: vi.fn(() => '/tmp/user-data') },
    existsSync: vi.fn(),
    fetch: vi.fn((url: string) => Promise.resolve(new Response(url))),
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn((scheme: string, handler: ProtocolHandler) => {
      protocolHandlers.set(scheme, handler)
    }),
    getProtocolHandler: (scheme: string) => protocolHandlers.get(scheme) ?? null,
    resetHandler: () => {
      protocolHandlers.clear()
    },
  }
})

vi.mock('node:fs', () => ({
  existsSync: protocolMocks.existsSync,
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: protocolMocks.is,
}))

vi.mock('electron', () => ({
  app: protocolMocks.app,
  net: {
    fetch: protocolMocks.fetch,
  },
  protocol: {
    registerSchemesAsPrivileged: protocolMocks.registerSchemesAsPrivileged,
    handle: protocolMocks.handle,
  },
}))

vi.mock('../env', () => ({
  env: protocolMocks.env,
}))

let tmpRoot = ''

async function loadRendererProtocol() {
  return import('../renderer-protocol')
}

async function loadExtensionRuntimeProtocol() {
  return import('../extension-runtime-protocol')
}

async function loadExtensionFrameProtocol() {
  return import('../extension-frame-protocol')
}

function dispatchProtocolRequest(scheme: string, url: string) {
  const handler = protocolMocks.getProtocolHandler(scheme)
  if (!handler) throw new Error('Expected protocol handler')
  return handler({ url })
}

describe('renderer protocol', () => {
  beforeEach(async () => {
    vi.resetModules()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-renderer-protocol-'))
    protocolMocks.is.dev = false
    protocolMocks.env.ELECTRON_RENDERER_URL = ''
    protocolMocks.app.getPath.mockReturnValue(path.join(tmpRoot, 'user-data'))
    protocolMocks.existsSync.mockReset()
    protocolMocks.fetch.mockClear()
    protocolMocks.registerSchemesAsPrivileged.mockClear()
    protocolMocks.handle.mockClear()
    protocolMocks.resetHandler()
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
      tmpRoot = ''
    }
  })

  it('registers the custom renderer scheme as a privileged secure protocol', async () => {
    const { EXTENSION_RUNTIME_PROTOCOL, RENDERER_PROTOCOL, registerRendererScheme } =
      await loadRendererProtocol()

    registerRendererScheme()

    expect(protocolMocks.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: RENDERER_PROTOCOL,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
      {
        scheme: EXTENSION_RUNTIME_PROTOCOL,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
      {
        scheme: OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
    ])
  })

  it('skips file protocol registration while a dev renderer URL is active', async () => {
    protocolMocks.is.dev = true
    protocolMocks.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const { devRendererUrl, registerRendererProtocolOnce } = await loadRendererProtocol()

    registerRendererProtocolOnce()

    expect(devRendererUrl()).toBe('http://localhost:5173')
    expect(protocolMocks.handle).not.toHaveBeenCalled()
  })

  it('serves existing renderer assets and returns not-found for missing assets', async () => {
    protocolMocks.existsSync.mockImplementation((candidatePath: string) =>
      candidatePath.endsWith('assets/main.js'),
    )
    const { registerRendererProtocolOnce } = await loadRendererProtocol()

    registerRendererProtocolOnce()

    const assetResponse = await dispatchProtocolRequest(
      'openwaggle',
      'openwaggle://app/assets/main.js',
    )
    const missingAssetResponse = await dispatchProtocolRequest(
      'openwaggle',
      'openwaggle://app/assets/missing.js',
    )

    expect(assetResponse.status).toBe(HTTP_OK_STATUS)
    expect(assetResponse.headers.get('access-control-allow-origin')).toBe('*')
    await expect(assetResponse.text()).resolves.toContain('assets/main.js')
    expect(missingAssetResponse.status).toBe(HTTP_NOT_FOUND_STATUS)
  })

  it('falls back to index.html for deep links, invalid hosts, traversal, and malformed URLs', async () => {
    protocolMocks.existsSync.mockReturnValue(false)
    const { registerRendererProtocolOnce } = await loadRendererProtocol()

    registerRendererProtocolOnce()

    expect(
      await (
        await dispatchProtocolRequest('openwaggle', 'openwaggle://app/sessions/session-1')
      ).text(),
    ).toContain('index.html')
    expect(
      await (await dispatchProtocolRequest('openwaggle', 'openwaggle://other-host/session')).text(),
    ).toContain('index.html')
    expect(
      (await dispatchProtocolRequest('openwaggle', 'openwaggle://other-host/assets/main.js'))
        .status,
    ).toBe(HTTP_NOT_FOUND_STATUS)
    expect(
      (await dispatchProtocolRequest('openwaggle', 'openwaggle://app/%2e%2e/secret.txt')).status,
    ).toBe(HTTP_NOT_FOUND_STATUS)
    expect(await (await dispatchProtocolRequest('openwaggle', 'not a url')).text()).toContain(
      'index.html',
    )
  })

  it('does not register protocol handlers more than once', async () => {
    const { registerRendererProtocolOnce } = await loadRendererProtocol()
    const { registerExtensionRuntimeProtocolOnce } = await loadExtensionRuntimeProtocol()
    const { registerExtensionFrameProtocolOnce } = await loadExtensionFrameProtocol()

    registerRendererProtocolOnce()
    registerRendererProtocolOnce()
    registerExtensionRuntimeProtocolOnce()
    registerExtensionRuntimeProtocolOnce()
    registerExtensionFrameProtocolOnce()
    registerExtensionFrameProtocolOnce()

    expect(protocolMocks.handle).toHaveBeenCalledTimes(3)
  })
})
