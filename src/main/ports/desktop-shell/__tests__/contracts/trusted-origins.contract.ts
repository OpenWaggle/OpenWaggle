import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { TrustedOriginDomain, TrustedOriginsShape } from '../../trusted-origins'

export interface TrustedOriginsContractHarness {
  readonly subject: TrustedOriginsShape
  /** A page requests `url`; resolves to what the domain's handler answered. */
  readonly request: (url: string) => Promise<Response>
}

const DOMAINS: readonly TrustedOriginDomain[] = [
  'renderer',
  'extension-runtime',
  'extension-frame',
  'inline-visualization',
  'mcp-app-frame',
  'session-resource',
]

export const trustedOriginsContract = definePortContract<TrustedOriginsContractHarness>(
  'TrustedOrigins',
  {
    'gives every domain its own origin, addressed by host': async ({ subject }) => {
      const origins = DOMAINS.map((domain) => subject.originOf(domain, 'frame-1'))
      expect(new Set(origins).size).toBe(DOMAINS.length)
      for (const origin of origins) expect(new URL(`${origin}/probe`).host).toBe('frame-1')
    },

    'routes a request on a domain origin to that domain handler only': async ({
      subject,
      request,
    }) => {
      subject.declare(
        DOMAINS.map((domain) => ({ domain, corsEnabled: domain === 'renderer', codeCache: false })),
      )
      subject.serve('renderer', () => new Response('renderer'))
      subject.serve('session-resource', (incoming) => new Response(new URL(incoming.url).pathname))
      const renderer = await request(`${subject.originOf('renderer', 'app')}/index.html`)
      expect(await renderer.text()).toBe('renderer')
      const resource = await request(`${subject.originOf('session-resource', 's-1')}/image.png`)
      expect(await resource.text()).toBe('/image.png')
    },
  },
)
