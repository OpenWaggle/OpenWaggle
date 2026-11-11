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

function declareAll(subject: TrustedOriginsShape) {
  subject.declare(
    DOMAINS.map((domain) => ({ domain, corsEnabled: domain === 'renderer', codeCache: false })),
  )
}

/** A CSP source-expression match, enough for the scheme and origin sources shells write. */
function sourceMatches(source: string, url: string) {
  const target = new URL(url)
  if (/^[a-z][a-z0-9+.-]*:$/iu.test(source)) return target.protocol === source
  const pattern = new URL(source.replace(':*', ':1'))
  const anyPort = source.endsWith(':*')
  return (
    pattern.protocol === target.protocol &&
    pattern.hostname === target.hostname &&
    (anyPort || pattern.port === target.port)
  )
}

export const trustedOriginsContract = definePortContract<TrustedOriginsContractHarness>(
  'TrustedOrigins',
  {
    'gives every domain and every host of a domain its own origin': async ({ subject }) => {
      declareAll(subject)
      // `URL.origin` is "null" for a custom scheme, so compare scheme and host as pages see them.
      const origin = (domain: TrustedOriginDomain, host: string) => {
        const url = new URL(`${subject.originOf(domain, host)}/probe`)
        return `${url.protocol}//${url.host}`
      }
      expect(new Set(DOMAINS.map((domain) => origin(domain, 'frame-1'))).size).toBe(DOMAINS.length)
      expect(origin('inline-visualization', 'frame-2')).not.toBe(
        origin('inline-visualization', 'frame-1'),
      )
      expect(subject.originOf('renderer', 'app')).toBe(subject.originOf('renderer', 'app'))
    },

    'routes a request on a domain origin to that domain handler only, under its host': async ({
      subject,
      request,
    }) => {
      declareAll(subject)
      subject.serve('renderer', () => new Response('renderer'))
      subject.serve('session-resource', (incoming) => {
        const url = new URL(incoming.url)
        return new Response(`${url.host}${url.pathname}${url.search}`)
      })
      const renderer = await request(`${subject.originOf('renderer', 'app')}/index.html`)
      expect(await renderer.text()).toBe('renderer')
      const resource = await request(`${subject.originOf('session-resource', 's-1')}/image.png?v=1`)
      expect(await resource.text()).toBe('s-1/image.png?v=1')
    },

    'writes policy sources that match the origins of the hosts named': async ({ subject }) => {
      declareAll(subject)
      const document = `${subject.originOf('inline-visualization', 'frame-1')}/document`
      for (const sources of [
        subject.sourcesOf('inline-visualization', ['frame-1']),
        subject.sourcesOf('inline-visualization'),
      ]) {
        expect(sources.some((source) => sourceMatches(source, document))).toBe(true)
      }
    },

    'serves a released host again once it is addressed again': async ({ subject, request }) => {
      declareAll(subject)
      subject.serve('mcp-app-frame', (incoming) => new Response(new URL(incoming.url).host))
      subject.originOf('mcp-app-frame', 'frame-1')
      subject.release('mcp-app-frame', 'frame-1')
      subject.release('mcp-app-frame', 'never-addressed')
      const again = await request(`${subject.originOf('mcp-app-frame', 'frame-1')}/document`)
      expect(await again.text()).toBe('frame-1')
    },
  },
)
