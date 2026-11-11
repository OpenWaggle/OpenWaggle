import { trustedOriginBasesFromRendererArguments } from '@shared/trusted-origin-bases-argument'
import { describe, expect, it, vi } from 'vitest'
import { memoryRememberedPorts } from '../adapters/electrobun/__tests__/loopback-test-support'
import { trustedOriginBaseRendererArguments } from '../trusted-origin-base-arguments'

vi.mock('../desktop-shell/app-paths', () => ({
  appPaths: { userData: () => '/nonexistent-user-data' },
}))

describe('trusted origin base renderer arguments', () => {
  it('pass the Electrobun loopback base, whose module URLs reach the extension runtime handler', async () => {
    const { createLoopbackTrustedOrigins } =
      await import('../adapters/electrobun/electrobun-trusted-origins')
    const origins = createLoopbackTrustedOrigins({ rememberedPorts: memoryRememberedPorts() })
    origins.declare([{ domain: 'extension-runtime', corsEnabled: true, codeCache: true }])
    const seen: string[] = []
    origins.serve('extension-runtime', (request) => {
      seen.push(request.url)
      return new Response('export const mount = () => undefined')
    })

    try {
      const bases = trustedOriginBasesFromRendererArguments(
        trustedOriginBaseRendererArguments(origins),
      )
      expect(bases?.extensionRuntime).toBe(origins.originOf('extension-runtime', 'runtime'))
      const response = await fetch(`${bases?.extensionRuntime ?? ''}/module/pkg/hash/%5B%5D/a.js`)

      expect(response.status).toBe(200)
      expect(seen).toEqual(['openwaggle-extension://runtime/module/pkg/hash/%5B%5D/a.js'])
    } finally {
      origins.release('extension-runtime', 'runtime')
    }
  })
})
