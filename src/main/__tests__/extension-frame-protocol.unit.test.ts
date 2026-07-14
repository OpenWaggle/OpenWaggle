import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HTTP_FOUND_STATUS = 302
const HTTP_NOT_FOUND_STATUS = 404

interface ProtocolRequest {
  readonly url: string
}

type ProtocolHandler = (request: ProtocolRequest) => Response | Promise<Response>

const protocolMocks = vi.hoisted(() => {
  const protocolHandlers = new Map<string, ProtocolHandler>()
  return {
    is: { dev: true },
    env: { ELECTRON_RENDERER_URL: 'http://localhost:5173' },
    handle: vi.fn((scheme: string, handler: ProtocolHandler) => {
      protocolHandlers.set(scheme, handler)
    }),
    getProtocolHandler: (scheme: string) => protocolHandlers.get(scheme) ?? null,
    resetHandler: () => {
      protocolHandlers.clear()
    },
  }
})

vi.mock('@electron-toolkit/utils', () => ({
  is: protocolMocks.is,
}))

vi.mock('electron', () => ({
  protocol: {
    handle: protocolMocks.handle,
  },
}))

vi.mock('../env', () => ({
  env: protocolMocks.env,
}))

async function loadExtensionFrameProtocol() {
  return import('../extension-frame-protocol')
}

function dispatchProtocolRequest(scheme: string, url: string) {
  const handler = protocolMocks.getProtocolHandler(scheme)
  if (!handler) throw new Error('Expected protocol handler')
  return handler({ url })
}

describe('extension frame protocol', () => {
  beforeEach(() => {
    vi.resetModules()
    protocolMocks.is.dev = true
    protocolMocks.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    protocolMocks.handle.mockClear()
    protocolMocks.resetHandler()
  })

  it('serves the static frame document and CSS with per-frame CSP', async () => {
    const { registerExtensionFrame, registerExtensionFrameProtocolOnce, unregisterExtensionFrame } =
      await loadExtensionFrameProtocol()

    registerExtensionFrameProtocolOnce()
    const registration = registerExtensionFrame({
      frameId: 'frame-1',
      bootstrapUrl: 'http://localhost:5173/bootstrap.js',
      networkOrigins: ['https://api.github.com'],
    })

    const documentResponse = await dispatchProtocolRequest(
      'openwaggle-extension-frame',
      registration.frameUrl,
    )
    const documentText = await documentResponse.text()
    const csp = documentResponse.headers.get('content-security-policy') ?? ''

    expect(documentText).toContain('<div id="openwaggle-extension-root"></div>')
    expect(documentText).toContain('<link rel="stylesheet" href="./frame.css">')
    expect(documentText).toContain('<script type="module" src="./bootstrap.js"></script>')
    expect(documentText).not.toContain(EXTENSION_FRAME_MESSAGE_CHANNEL)
    expect(documentResponse.headers.get('content-type')).toContain('text/html')
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain(
      'script-src openwaggle-extension-frame: http://localhost:5173 openwaggle-extension:',
    )
    expect(csp).toContain("style-src openwaggle-extension-frame: 'unsafe-inline'")
    expect(csp).toContain('connect-src https://api.github.com ws://localhost:* ws://127.0.0.1:*')

    const styleResponse = await dispatchProtocolRequest(
      'openwaggle-extension-frame',
      new URL('./frame.css', registration.frameUrl).toString(),
    )

    expect(styleResponse.status).not.toBe(HTTP_NOT_FOUND_STATUS)
    expect(await styleResponse.text()).toContain('#openwaggle-extension-root')
    expect(styleResponse.headers.get('content-type')).toContain('text/css')

    unregisterExtensionFrame({
      frameId: 'frame-1',
      registrationId: registration.registrationId,
    })
    const unregisteredResponse = await dispatchProtocolRequest(
      'openwaggle-extension-frame',
      registration.frameUrl,
    )
    expect(unregisteredResponse.status).toBe(HTTP_NOT_FOUND_STATUS)
  })

  it('redirects bootstrap requests to the compiled renderer bootstrap module URL', async () => {
    const { registerExtensionFrame, registerExtensionFrameProtocolOnce } =
      await loadExtensionFrameProtocol()
    const bootstrapUrl = 'http://localhost:5173/assets/extension-frame-bootstrap.js'

    registerExtensionFrameProtocolOnce()
    const registration = registerExtensionFrame({
      frameId: 'frame-1',
      bootstrapUrl,
    })

    const bootstrapResponse = await dispatchProtocolRequest(
      'openwaggle-extension-frame',
      new URL('./bootstrap.js', registration.frameUrl).toString(),
    )

    expect(bootstrapResponse.status).toBe(HTTP_FOUND_STATUS)
    expect(bootstrapResponse.headers.get('location')).toBe(bootstrapUrl)
  })

  it('accepts packaged renderer bootstrap module URLs', async () => {
    protocolMocks.is.dev = false
    protocolMocks.env.ELECTRON_RENDERER_URL = ''
    const { registerExtensionFrame, registerExtensionFrameProtocolOnce } =
      await loadExtensionFrameProtocol()
    const bootstrapUrl = 'openwaggle://app/assets/extension-frame-bootstrap.js'

    registerExtensionFrameProtocolOnce()
    const registration = registerExtensionFrame({
      frameId: 'frame-1',
      bootstrapUrl,
    })

    const bootstrapResponse = await dispatchProtocolRequest(
      'openwaggle-extension-frame',
      new URL('./bootstrap.js', registration.frameUrl).toString(),
    )

    expect(bootstrapResponse.status).toBe(HTTP_FOUND_STATUS)
    expect(bootstrapResponse.headers.get('location')).toBe(bootstrapUrl)
  })

  it.each([
    'data:text/javascript,globalThis.pwned=1',
    'file:///tmp/bootstrap.js',
    'javascript:alert(1)',
    'https://example.com/bootstrap.js',
    'http://api.github.com/bootstrap.js',
    'openwaggle://other-host/assets/bootstrap.js',
  ])('rejects untrusted bootstrap URL %s', async (bootstrapUrl) => {
    const { registerExtensionFrame } = await loadExtensionFrameProtocol()

    expect(() =>
      registerExtensionFrame({
        frameId: 'frame-1',
        bootstrapUrl,
      }),
    ).toThrow('Extension frame bootstrap URL must use the OpenWaggle renderer origin.')
  })

  it.each([
    'http://api.github.com',
    'https://api.github.com/repos',
    'data:text/plain,hi',
  ])('rejects untrusted network origin %s', async (networkOrigin) => {
    const { registerExtensionFrame } = await loadExtensionFrameProtocol()

    expect(() =>
      registerExtensionFrame({
        frameId: 'frame-1',
        bootstrapUrl: 'http://localhost:5173/bootstrap.js',
        networkOrigins: [networkOrigin],
      }),
    ).toThrow('Extension frame network origin')
  })

  it('ignores stale unregister calls from superseded frame registrations', async () => {
    const { registerExtensionFrame, registerExtensionFrameProtocolOnce, unregisterExtensionFrame } =
      await loadExtensionFrameProtocol()

    registerExtensionFrameProtocolOnce()
    const staleRegistration = registerExtensionFrame({
      frameId: 'frame-1',
      bootstrapUrl: 'http://localhost:5173/stale-bootstrap.js',
    })
    const activeRegistration = registerExtensionFrame({
      frameId: 'frame-1',
      bootstrapUrl: 'http://localhost:5173/active-bootstrap.js',
    })

    unregisterExtensionFrame({
      frameId: 'frame-1',
      registrationId: staleRegistration.registrationId,
    })

    const documentResponse = await dispatchProtocolRequest(
      'openwaggle-extension-frame',
      activeRegistration.frameUrl,
    )
    const bootstrapResponse = await dispatchProtocolRequest(
      'openwaggle-extension-frame',
      new URL('./bootstrap.js', activeRegistration.frameUrl).toString(),
    )

    expect(documentResponse.status).not.toBe(HTTP_NOT_FOUND_STATUS)
    expect(bootstrapResponse.headers.get('location')).toBe(
      'http://localhost:5173/active-bootstrap.js',
    )
  })

  it('returns not-found for unknown frame resources', async () => {
    const { registerExtensionFrameProtocolOnce } = await loadExtensionFrameProtocol()

    registerExtensionFrameProtocolOnce()

    expect(
      (
        await dispatchProtocolRequest(
          'openwaggle-extension-frame',
          'openwaggle-extension-frame://frame/frames/missing/index.html',
        )
      ).status,
    ).toBe(HTTP_NOT_FOUND_STATUS)
  })
})
