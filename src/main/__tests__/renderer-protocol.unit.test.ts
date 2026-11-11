import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION_FRAME_PROTOCOL } from '@shared/constants/extension-frame'
import { INLINE_VISUALIZATION_PROTOCOL } from '@shared/constants/inline-visualization'
import { MCP_APP_FRAME_PROTOCOL } from '@shared/constants/mcp-app-frame'
import { SESSION_RESOURCE_PROTOCOL } from '@shared/constants/session-resource-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HTTP_OK_STATUS = 200
const HTTP_NOT_FOUND_STATUS = 404
// Full-suite workers can contend while Vitest transforms the renderer protocol graph.
const MODULE_LOAD_TEST_TIMEOUT_MS = 60_000

interface RendererProtocolEnvMock {
  ELECTRON_RENDERER_URL: string
  OPENWAGGLE_AUTOMATION_LEASE_TOKEN: string | undefined
}

const protocolMocks = await vi.hoisted(async () => {
  const { fakeAppPaths, fakeNetworkFetch, fakeTrustedOrigins } =
    await import('../test-support/fake-desktop-shell')
  const env: RendererProtocolEnvMock = {
    ELECTRON_RENDERER_URL: '',
    OPENWAGGLE_AUTOMATION_LEASE_TOKEN: undefined,
  }
  const networkFetch = fakeNetworkFetch()
  networkFetch.fetch.mockImplementation((input) =>
    Promise.resolve(new Response(typeof input === 'string' ? input : input.url)),
  )
  return {
    is: { dev: false },
    env,
    appendSwitch: vi.fn(),
    appPaths: fakeAppPaths('/tmp/user-data'),
    existsSync: vi.fn(),
    networkFetch,
    trustedOrigins: fakeTrustedOrigins(),
  }
})

vi.mock('node:fs', () => ({
  existsSync: protocolMocks.existsSync,
}))

vi.mock('../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle({
    isPackaged: () => !protocolMocks.is.dev,
    commandLine: {
      appendSwitch: protocolMocks.appendSwitch,
      hasSwitch: () => false,
      getSwitchValue: () => '',
    },
  }),
}))
vi.mock('../desktop-shell/app-paths', () => ({ appPaths: protocolMocks.appPaths }))
vi.mock('../desktop-shell/network-fetch', () => ({ networkFetch: protocolMocks.networkFetch }))
vi.mock('../desktop-shell/trusted-origins', () => ({
  trustedOrigins: protocolMocks.trustedOrigins,
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

function dispatchProtocolRequest(url: string) {
  return protocolMocks.trustedOrigins.dispatch('renderer', url)
}

describe('renderer protocol', () => {
  beforeEach(async () => {
    vi.resetModules()
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-renderer-protocol-'))
    protocolMocks.is.dev = false
    protocolMocks.env.ELECTRON_RENDERER_URL = ''
    protocolMocks.env.OPENWAGGLE_AUTOMATION_LEASE_TOKEN = undefined
    protocolMocks.appPaths.setUserData(path.join(tmpRoot, 'user-data'))
    protocolMocks.existsSync.mockReset()
    protocolMocks.networkFetch.fetch.mockClear()
    protocolMocks.appendSwitch.mockClear()
    protocolMocks.trustedOrigins.reset()
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
      tmpRoot = ''
    }
  })

  it('registers the custom renderer scheme as a privileged secure protocol with V8 code caching', async () => {
    const { EXTENSION_RUNTIME_PROTOCOL, RENDERER_PROTOCOL, registerRendererScheme } =
      await loadRendererProtocol()

    registerRendererScheme()

    expect(protocolMocks.trustedOrigins.declare).toHaveBeenCalledWith([
      { domain: 'renderer', corsEnabled: true, codeCache: true },
      { domain: 'extension-runtime', corsEnabled: true, codeCache: true },
      { domain: 'extension-frame', corsEnabled: true, codeCache: true },
      { domain: 'inline-visualization', corsEnabled: false, codeCache: false },
      { domain: 'mcp-app-frame', corsEnabled: false, codeCache: false },
      { domain: 'session-resource', corsEnabled: false, codeCache: false },
    ])
    // Each domain is the custom scheme pages address it by.
    expect(
      protocolMocks.trustedOrigins.declare.mock.calls[0]?.[0].map(({ domain }) =>
        protocolMocks.trustedOrigins.originOf(domain, 'app'),
      ),
    ).toEqual(
      [
        RENDERER_PROTOCOL,
        EXTENSION_RUNTIME_PROTOCOL,
        OPENWAGGLE_EXTENSION_FRAME_PROTOCOL.SCHEME,
        INLINE_VISUALIZATION_PROTOCOL.SCHEME,
        MCP_APP_FRAME_PROTOCOL.SCHEME,
        SESSION_RESOURCE_PROTOCOL.SCHEME,
      ].map((scheme) => `${scheme}://app`),
    )
  })

  it('enforces out-of-process isolation for visualization origins before startup', async () => {
    const { configureInlineVisualizationProcessIsolation } = await loadRendererProtocol()

    configureInlineVisualizationProcessIsolation()

    expect(protocolMocks.appendSwitch).toHaveBeenCalledExactlyOnceWith('site-per-process')
  })

  it('skips file protocol registration while a dev renderer URL is active', async () => {
    protocolMocks.is.dev = true
    protocolMocks.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const { devRendererUrl, registerRendererProtocolOnce } = await loadRendererProtocol()

    registerRendererProtocolOnce()

    expect(devRendererUrl()).toBe('http://localhost:5173')
    expect(protocolMocks.trustedOrigins.serve).not.toHaveBeenCalled()
  })

  it('adds the managed launcher identity to the renderer URL', async () => {
    protocolMocks.env.OPENWAGGLE_AUTOMATION_LEASE_TOKEN = 'qa-identity'
    const { rendererUrlWithAutomationIdentity } = await loadRendererProtocol()

    expect(rendererUrlWithAutomationIdentity('http://localhost:5173')).toBe(
      'http://localhost:5173/?openwaggle-automation-id=qa-identity',
    )
  })

  it('serves existing renderer assets and returns not-found for missing assets', async () => {
    protocolMocks.existsSync.mockImplementation((candidatePath: string) =>
      candidatePath.endsWith('assets/main.js'),
    )
    const { registerRendererProtocolOnce } = await loadRendererProtocol()

    registerRendererProtocolOnce()

    const assetResponse = await dispatchProtocolRequest('openwaggle://app/assets/main.js')
    const missingAssetResponse = await dispatchProtocolRequest('openwaggle://app/assets/missing.js')

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
      await (await dispatchProtocolRequest('openwaggle://app/sessions/session-1')).text(),
    ).toContain('index.html')
    expect(
      await (await dispatchProtocolRequest('openwaggle://other-host/session')).text(),
    ).toContain('index.html')
    expect((await dispatchProtocolRequest('openwaggle://other-host/assets/main.js')).status).toBe(
      HTTP_NOT_FOUND_STATUS,
    )
    expect((await dispatchProtocolRequest('openwaggle://app/%2e%2e/secret.txt')).status).toBe(
      HTTP_NOT_FOUND_STATUS,
    )
    // A `Request` cannot carry a malformed URL, so a partial one proves the fallback.
    const malformed = fromPartial<Request>({ url: 'not a url' })
    expect(
      await (await protocolMocks.trustedOrigins.handlerOf('renderer')(malformed)).text(),
    ).toContain('index.html')
  })

  it(
    'does not register protocol handlers more than once',
    async () => {
      const [rendererProtocol, extensionRuntimeProtocol, extensionFrameProtocol] =
        await Promise.all([
          loadRendererProtocol(),
          loadExtensionRuntimeProtocol(),
          loadExtensionFrameProtocol(),
        ])

      rendererProtocol.registerRendererProtocolOnce()
      rendererProtocol.registerRendererProtocolOnce()
      extensionRuntimeProtocol.registerExtensionRuntimeProtocolOnce()
      extensionRuntimeProtocol.registerExtensionRuntimeProtocolOnce()
      extensionFrameProtocol.registerExtensionFrameProtocolOnce()
      extensionFrameProtocol.registerExtensionFrameProtocolOnce()

      expect(protocolMocks.trustedOrigins.serve).toHaveBeenCalledTimes(3)
    },
    MODULE_LOAD_TEST_TIMEOUT_MS,
  )
})
