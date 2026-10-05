import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyOpenWaggleProviderAttribution,
  createProviderAttributionExtension,
} from '../provider-attribution-extension'

type Headers = Record<string, string | null>

const PI_PROVIDER_ATTRIBUTION_MODULE = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/core/provider-attribution.js',
)
const SESSION_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const AUTHORIZATION = { Authorization: 'Bearer sk-secret' }

const MODELS = {
  openrouter: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  nvidia: { provider: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  cloudflare: {
    provider: 'cloudflare-workers-ai',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/a/ai/v1',
  },
  opencode: { provider: 'opencode', baseUrl: 'https://opencode.ai/zen/v1' },
} as const

function isHeaders(value: unknown): value is Headers {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((item) => typeof item === 'string' || item === null)
  )
}

/** The headers Pi 0.87.1 attaches with install telemetry on, from Pi's own module. */
async function piAttributedHeaders(model: (typeof MODELS)[keyof typeof MODELS]) {
  const piModule: unknown = await import(pathToFileURL(PI_PROVIDER_ATTRIBUTION_MODULE).href)
  const merge: unknown =
    typeof piModule === 'object' && piModule !== null
      ? Reflect.get(piModule, 'mergeProviderAttributionHeaders')
      : undefined
  if (typeof merge !== 'function') throw new Error('Pi provider attribution moved')
  const telemetryOn = { getEnableInstallTelemetry: () => true }
  const headers: unknown = Reflect.apply(merge, undefined, [
    model,
    telemetryOn,
    SESSION_ID,
    AUTHORIZATION,
  ])
  if (!isHeaders(headers)) throw new Error('Pi provider attribution returned no headers')
  return headers
}

async function openWaggleHeaders(
  model: (typeof MODELS)[keyof typeof MODELS],
  statisticsEnabled: boolean,
) {
  let handler: ((event: { headers: Headers }) => unknown) | undefined
  await createProviderAttributionExtension(() => statisticsEnabled)(
    fromPartial<ExtensionAPI>({
      on: vi.fn((event: unknown, registered: unknown) => {
        if (event === 'before_provider_headers' && typeof registered === 'function') {
          handler = (headersEvent) => registered(headersEvent)
        }
      }),
    }),
  )
  const headers = await piAttributedHeaders(model)
  await handler?.({ headers })
  return headers
}

describe('OpenWaggle provider attribution', () => {
  beforeEach(() => {
    vi.stubEnv('PI_TELEMETRY', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("starts from Pi's own attribution labels", async () => {
    expect(await piAttributedHeaders(MODELS.openrouter)).toEqual({
      'HTTP-Referer': 'https://pi.dev',
      'X-OpenRouter-Title': 'pi',
      'X-OpenRouter-Categories': 'cli-agent',
      ...AUTHORIZATION,
    })
    expect(await piAttributedHeaders(MODELS.nvidia)).toEqual({
      'X-BILLING-INVOKE-ORIGIN': 'Pi',
      ...AUTHORIZATION,
    })
    expect(await piAttributedHeaders(MODELS.cloudflare)).toEqual({
      'User-Agent': 'pi-coding-agent',
      ...AUTHORIZATION,
    })
  })

  it('labels requests OpenWaggle while Usage statistics are on', async () => {
    expect(await openWaggleHeaders(MODELS.openrouter, true)).toEqual({
      'HTTP-Referer': 'https://openwaggle.ai',
      'X-OpenRouter-Title': 'OpenWaggle',
      ...AUTHORIZATION,
    })
    expect(await openWaggleHeaders(MODELS.nvidia, true)).toEqual({
      'X-BILLING-INVOKE-ORIGIN': 'OpenWaggle',
      ...AUTHORIZATION,
    })
    expect(await openWaggleHeaders(MODELS.cloudflare, true)).toEqual({
      'User-Agent': 'OpenWaggle',
      ...AUTHORIZATION,
    })
  })

  it("removes all of Pi's attribution while Usage statistics are off", async () => {
    expect(await openWaggleHeaders(MODELS.openrouter, false)).toEqual(AUTHORIZATION)
    expect(await openWaggleHeaders(MODELS.nvidia, false)).toEqual(AUTHORIZATION)
    expect(await openWaggleHeaders(MODELS.cloudflare, false)).toEqual(AUTHORIZATION)
  })

  it('never touches opencode session headers or authentication', async () => {
    const opencode = {
      'x-opencode-session': SESSION_ID,
      'x-opencode-client': 'pi',
      ...AUTHORIZATION,
    }

    expect(await openWaggleHeaders(MODELS.opencode, true)).toEqual(opencode)
    expect(await openWaggleHeaders(MODELS.opencode, false)).toEqual(opencode)
  })

  it('leaves headers a user or provider configured with other values alone', () => {
    const headers: Headers = {
      'http-referer': 'https://example.com',
      'X-OpenRouter-Title': 'My App',
      'User-Agent': 'claude-cli/2.1.0',
      'X-Custom': 'pi',
    }

    applyOpenWaggleProviderAttribution(headers, false)
    applyOpenWaggleProviderAttribution(headers, true)

    expect(headers).toEqual({
      'http-referer': 'https://example.com',
      'X-OpenRouter-Title': 'My App',
      'User-Agent': 'claude-cli/2.1.0',
      'X-Custom': 'pi',
    })
  })
})
