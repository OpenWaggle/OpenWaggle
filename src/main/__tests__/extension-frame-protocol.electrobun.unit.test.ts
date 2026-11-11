import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const HTTP_FOUND_STATUS = 302

vi.mock('electron', () => ({}))
vi.mock('../desktop-shell/app-paths', () => ({
  appPaths: { userData: () => '/nonexistent-user-data' },
}))
vi.mock('../desktop-shell/app-lifecycle', () => ({ appLifecycle: { isPackaged: () => true } }))
vi.mock('../env', () => ({ env: { ELECTRON_RENDERER_URL: '' } }))
// The Electrobun shell's trusted origins: real loopback servers behind host capabilities.
vi.mock('../desktop-shell/trusted-origins', async () => {
  const { createLoopbackTrustedOrigins } =
    await import('../adapters/electrobun/electrobun-trusted-origins')
  const { memoryRememberedPorts } =
    await import('../adapters/electrobun/__tests__/loopback-test-support')
  return {
    trustedOrigins: createLoopbackTrustedOrigins({ rememberedPorts: memoryRememberedPorts() }),
  }
})

type Subject = typeof import('../extension-frame-protocol')
type Origins = (typeof import('../desktop-shell/trusted-origins'))['trustedOrigins']

let subject: Subject
let origins: Origins

beforeAll(async () => {
  origins = (await import('../desktop-shell/trusted-origins')).trustedOrigins
  const { registerRendererScheme } = await import('../renderer-protocol')
  registerRendererScheme()
  subject = await import('../extension-frame-protocol')
  subject.registerExtensionFrameProtocolOnce()
})

afterAll(() => {
  origins.release('renderer', 'app')
  origins.release('extension-frame', 'frame')
  origins.release('extension-runtime', 'runtime')
})

const originOfHost = (domain: Parameters<Origins['originOf']>[0], host: string) =>
  new URL(origins.originOf(domain, host)).origin

describe('extension frame protocol on the Electrobun loopback origins', () => {
  it('serves each frame from the frame host, with a policy naming the exact loopback origins', async () => {
    const bootstrapUrl = `${origins.originOf('renderer', 'app')}/assets/extension-frame-bootstrap.js`
    const registration = subject.registerExtensionFrame({
      frameId: ':r1:',
      bootstrapUrl,
      networkOrigins: ['https://api.github.com'],
    })

    expect(registration.frameUrl).toBe(
      `${origins.originOf('extension-frame', 'frame')}/frames/%3Ar1%3A/index.html`,
    )
    const document = await fetch(registration.frameUrl)
    const frameOrigin = originOfHost('extension-frame', 'frame')
    const scriptSources = [
      frameOrigin,
      originOfHost('renderer', 'app'),
      originOfHost('extension-runtime', 'runtime'),
    ].join(' ')
    expect(document.headers.get('content-security-policy')).toBe(
      [
        "default-src 'none'",
        `script-src ${scriptSources}`,
        `script-src-elem ${scriptSources}`,
        `style-src ${frameOrigin} 'unsafe-inline'`,
        "base-uri 'none'",
        "form-action 'none'",
        // A built renderer has no Vite socket, so the frame reaches only its network origins.
        'connect-src https://api.github.com',
      ].join('; '),
    )

    const bootstrap = await fetch(new URL('./bootstrap.js', registration.frameUrl), {
      redirect: 'manual',
    })
    expect(bootstrap.status).toBe(HTTP_FOUND_STATUS)
    expect(bootstrap.headers.get('location')).toBe(bootstrapUrl)
  })

  it.each([
    ['the renderer origin without its capability', () => originOfHost('renderer', 'app')],
    ['another trusted origin', () => origins.originOf('extension-runtime', 'runtime')],
    ["Electron's renderer scheme", () => 'openwaggle://app'],
  ])('refuses a bootstrap module from %s', (_name, base) => {
    expect(() =>
      subject.registerExtensionFrame({
        frameId: 'frame-2',
        bootstrapUrl: `${base()}/bootstrap.js`,
      }),
    ).toThrow('Extension frame bootstrap URL must use the OpenWaggle renderer origin.')
  })
})
