import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HTTP_FOUND_STATUS = 302
const HTTP_NOT_FOUND_STATUS = 404

const protocolMocks = await vi.hoisted(async () => {
  const { fakeTrustedOrigins } = await import('../test-support/fake-desktop-shell')
  return {
    is: { dev: true },
    env: { ELECTRON_RENDERER_URL: 'http://localhost:5173' },
    trustedOrigins: fakeTrustedOrigins(),
  }
})

vi.mock('../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle({
    isPackaged: () => !protocolMocks.is.dev,
  }),
}))
vi.mock('../desktop-shell/trusted-origins', () => ({
  trustedOrigins: protocolMocks.trustedOrigins,
}))

vi.mock('../env', () => ({
  env: protocolMocks.env,
}))

async function loadExtensionFrameProtocol() {
  return import('../extension-frame-protocol')
}

function dispatchProtocolRequest(url: string) {
  return protocolMocks.trustedOrigins.dispatchUrl(url)
}

describe('extension frame protocol', () => {
  beforeEach(() => {
    vi.resetModules()
    protocolMocks.is.dev = true
    protocolMocks.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    protocolMocks.trustedOrigins.reset()
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

    const documentResponse = await dispatchProtocolRequest(registration.frameUrl)
    const documentText = await documentResponse.text()
    const csp = documentResponse.headers.get('content-security-policy') ?? ''

    expect(documentText).toContain(
      '<div id="openwaggle-extension-root" class="ow-extension-root"></div>',
    )
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
      new URL('./frame.css', registration.frameUrl).toString(),
    )

    expect(styleResponse.status).not.toBe(HTTP_NOT_FOUND_STATUS)
    expect(await styleResponse.text()).toContain('#openwaggle-extension-root')
    expect(styleResponse.headers.get('content-type')).toContain('text/css')

    unregisterExtensionFrame({
      frameId: 'frame-1',
      registrationId: registration.registrationId,
    })
    const unregisteredResponse = await dispatchProtocolRequest(registration.frameUrl)
    const lateStyleResponse = await dispatchProtocolRequest(
      new URL('./frame.css', registration.frameUrl).toString(),
    )
    expect(unregisteredResponse.status).toBe(HTTP_NOT_FOUND_STATUS)
    expect(lateStyleResponse.status).not.toBe(HTTP_NOT_FOUND_STATUS)
    expect(await lateStyleResponse.text()).toContain('#openwaggle-extension-root')
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

  it.each(['http://api.github.com', 'https://api.github.com/repos', 'data:text/plain,hi'])(
    'rejects untrusted network origin %s',
    async (networkOrigin) => {
      const { registerExtensionFrame } = await loadExtensionFrameProtocol()

      expect(() =>
        registerExtensionFrame({
          frameId: 'frame-1',
          bootstrapUrl: 'http://localhost:5173/bootstrap.js',
          networkOrigins: [networkOrigin],
        }),
      ).toThrow('Extension frame network origin')
    },
  )

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

    const documentResponse = await dispatchProtocolRequest(activeRegistration.frameUrl)
    const bootstrapResponse = await dispatchProtocolRequest(
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
          'openwaggle-extension-frame://frame/frames/missing/index.html',
        )
      ).status,
    ).toBe(HTTP_NOT_FOUND_STATUS)
  })
})
