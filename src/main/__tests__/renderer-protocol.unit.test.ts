import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FileProtocolRequest {
  readonly url: string
}
interface FileProtocolResponse {
  readonly path?: string
  readonly error?: number
}
type FileProtocolCallback = (response: FileProtocolResponse) => void
type FileProtocolHandler = (request: FileProtocolRequest, callback: FileProtocolCallback) => void

const protocolMocks = vi.hoisted(() => {
  let fileProtocolHandler: FileProtocolHandler | null = null
  return {
    is: { dev: false },
    env: { ELECTRON_RENDERER_URL: '' },
    existsSync: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
    registerFileProtocol: vi.fn((_: string, handler: FileProtocolHandler) => {
      fileProtocolHandler = handler
    }),
    getFileProtocolHandler: () => fileProtocolHandler,
    resetHandler: () => {
      fileProtocolHandler = null
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
  protocol: {
    registerSchemesAsPrivileged: protocolMocks.registerSchemesAsPrivileged,
    registerFileProtocol: protocolMocks.registerFileProtocol,
  },
}))

vi.mock('../env', () => ({
  env: protocolMocks.env,
}))

async function loadRendererProtocol() {
  return import('../renderer-protocol')
}

function requireProtocolResponse(response: FileProtocolResponse | null) {
  if (!response) throw new Error('Expected protocol callback response')
  return response
}

function dispatchProtocolRequest(url: string): FileProtocolResponse {
  const handler = protocolMocks.getFileProtocolHandler()
  if (!handler) throw new Error('Expected renderer file protocol handler')
  let response: FileProtocolResponse | null = null
  handler({ url }, (nextResponse) => {
    response = nextResponse
  })
  return requireProtocolResponse(response)
}

describe('renderer protocol', () => {
  beforeEach(() => {
    vi.resetModules()
    protocolMocks.is.dev = false
    protocolMocks.env.ELECTRON_RENDERER_URL = ''
    protocolMocks.existsSync.mockReset()
    protocolMocks.registerSchemesAsPrivileged.mockClear()
    protocolMocks.registerFileProtocol.mockClear()
    protocolMocks.resetHandler()
  })

  it('registers the custom renderer scheme as a privileged secure protocol', async () => {
    const { RENDERER_PROTOCOL, registerRendererScheme } = await loadRendererProtocol()

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
    ])
  })

  it('skips file protocol registration while a dev renderer URL is active', async () => {
    protocolMocks.is.dev = true
    protocolMocks.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    const { devRendererUrl, registerRendererProtocolOnce } = await loadRendererProtocol()

    registerRendererProtocolOnce()

    expect(devRendererUrl()).toBe('http://localhost:5173')
    expect(protocolMocks.registerFileProtocol).not.toHaveBeenCalled()
  })

  it('serves existing renderer assets and returns file-not-found for missing assets', async () => {
    protocolMocks.existsSync.mockImplementation((candidatePath: string) =>
      candidatePath.endsWith('assets/main.js'),
    )
    const { registerRendererProtocolOnce } = await loadRendererProtocol()

    registerRendererProtocolOnce()

    const assetResponse = dispatchProtocolRequest('openwaggle://app/assets/main.js')
    const missingAssetResponse = dispatchProtocolRequest('openwaggle://app/assets/missing.js')

    expect(assetResponse.path).toContain('assets/main.js')
    expect(missingAssetResponse).toEqual({ error: -6 })
  })

  it('falls back to index.html for deep links, invalid hosts, traversal, and malformed URLs', async () => {
    protocolMocks.existsSync.mockReturnValue(false)
    const { registerRendererProtocolOnce } = await loadRendererProtocol()

    registerRendererProtocolOnce()

    expect(dispatchProtocolRequest('openwaggle://app/sessions/session-1').path).toContain(
      'index.html',
    )
    expect(dispatchProtocolRequest('openwaggle://other-host/session').path).toContain('index.html')
    expect(dispatchProtocolRequest('openwaggle://other-host/assets/main.js')).toEqual({
      error: -6,
    })
    expect(dispatchProtocolRequest('openwaggle://app/%2e%2e/secret.txt')).toEqual({ error: -6 })
    expect(dispatchProtocolRequest('not a url').path).toContain('index.html')
  })
})
