import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type ClientIdentity,
  type Model,
  normalizeContext,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { stream as streamCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { SettingsManager, setClientIdentityTransform } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const statistics = vi.hoisted(() => ({ enabled: true }))

vi.mock('../../../usage-statistics/usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => statistics.enabled,
}))

const { installOpenWaggleProviderAttribution } = await import('../provider-attribution')

// Pi does not export the function it builds each request's identity with, so the tests read it
// from Pi's own module, as Pi's request options do (sdk.js, `buildRequestOptions`).
const PI_CLIENT_IDENTITY_MODULE = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/core/client-identity.js',
)

async function piRequestIdentity(): Promise<ClientIdentity> {
  const piModule: unknown = await import(pathToFileURL(PI_CLIENT_IDENTITY_MODULE).href)
  const getClientIdentity: unknown =
    typeof piModule === 'object' && piModule !== null
      ? Reflect.get(piModule, 'getClientIdentity')
      : undefined
  if (typeof getClientIdentity !== 'function') throw new Error('Pi client identity moved')
  // Pi's own install telemetry is on, so without OpenWaggle a request would carry Pi's labels.
  const identity: unknown = Reflect.apply(getClientIdentity, undefined, [
    SettingsManager.inMemory({ enableInstallTelemetry: true }),
  ])
  if (typeof identity !== 'object' || identity === null) throw new Error('No Pi client identity')
  return identity
}

const TARGETS = {
  openrouter: { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  nvidia: { provider: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  opencode: { provider: 'opencode', baseUrl: 'https://opencode.ai/zen/v1' },
  cloudflare: {
    provider: 'cloudflare-workers-ai',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/a/ai/v1',
  },
} as const

const ATTRIBUTION_HEADERS = [
  'http-referer',
  'x-openrouter-title',
  'x-openrouter-categories',
  'x-billing-invoke-origin',
  'x-opencode-client',
]

function model(
  target: (typeof TARGETS)[keyof typeof TARGETS],
  headers?: Record<string, string>,
): Model<'openai-completions'> {
  return {
    id: 'test-model',
    name: 'Test model',
    api: 'openai-completions',
    ...target,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
    ...(headers ? { headers } : {}),
  }
}

const CONTEXT: TranscriptContext = normalizeContext({
  messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
})

/** The headers of the real provider request Pi sends with its request identity. */
async function requestHeaders(requestModel: Model<'openai-completions'>) {
  let captured: Headers | undefined
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    captured = new Headers(init?.headers)
    return new Response('{"error":{"message":"stop"}}', { status: 400 })
  })
  const identity = await piRequestIdentity()
  await streamCompletions(requestModel, CONTEXT, {
    apiKey: 'sk-test',
    identity,
    fetch,
    maxRetries: 0,
  }).result()
  if (!captured) throw new Error('Pi sent no request')
  return captured
}

function attribution(headers: Headers) {
  return Object.fromEntries(
    ATTRIBUTION_HEADERS.flatMap((name) => {
      const value = headers.get(name)
      return value === null ? [] : [[name, value]]
    }),
  )
}

describe('OpenWaggle provider attribution', () => {
  beforeEach(() => {
    vi.stubEnv('PI_TELEMETRY', undefined)
    statistics.enabled = true
    installOpenWaggleProviderAttribution()
  })

  afterEach(() => {
    setClientIdentityTransform(undefined)
    vi.unstubAllEnvs()
  })

  it('labels requests OpenWaggle while Usage statistics are on', async () => {
    expect(attribution(await requestHeaders(model(TARGETS.openrouter)))).toEqual({
      'http-referer': 'https://openwaggle.ai',
      'x-openrouter-title': 'OpenWaggle',
    })
    expect(attribution(await requestHeaders(model(TARGETS.nvidia)))).toEqual({
      'x-billing-invoke-origin': 'OpenWaggle',
    })
    expect(attribution(await requestHeaders(model(TARGETS.opencode)))).toEqual({
      'x-opencode-client': 'OpenWaggle',
    })
    expect(attribution(await requestHeaders(model(TARGETS.cloudflare)))).toEqual({})
  })

  it("sends none of Pi's attribution while Usage statistics are off", async () => {
    statistics.enabled = false

    for (const target of Object.values(TARGETS)) {
      expect(attribution(await requestHeaders(model(target)))).toEqual({})
    }
  })

  it('follows the statistics switch on every request', async () => {
    const openrouter = model(TARGETS.openrouter)

    expect(attribution(await requestHeaders(openrouter))).not.toEqual({})
    statistics.enabled = false
    expect(attribution(await requestHeaders(openrouter))).toEqual({})
    statistics.enabled = true
    expect(attribution(await requestHeaders(openrouter))).not.toEqual({})
  })

  it("keeps Pi's User-Agent whether statistics are on or off", async () => {
    const userAgent = /^pi\/\d+\.\d+\.\d+ /
    expect((await requestHeaders(model(TARGETS.cloudflare))).get('user-agent')).toMatch(userAgent)
    statistics.enabled = false
    expect((await requestHeaders(model(TARGETS.cloudflare))).get('user-agent')).toMatch(userAgent)
  })

  it('leaves headers a user or provider configured alone', async () => {
    const configured = { 'HTTP-Referer': 'https://example.com', 'X-OpenRouter-Title': 'My App' }

    expect(attribution(await requestHeaders(model(TARGETS.openrouter, configured)))).toEqual({
      'http-referer': 'https://example.com',
      'x-openrouter-title': 'My App',
    })
    statistics.enabled = false
    expect(attribution(await requestHeaders(model(TARGETS.openrouter, configured)))).toEqual({
      'http-referer': 'https://example.com',
      'x-openrouter-title': 'My App',
    })
  })

  it("starts from Pi's own attribution when OpenWaggle's is not installed", async () => {
    setClientIdentityTransform(undefined)

    expect(attribution(await requestHeaders(model(TARGETS.openrouter)))).toEqual({
      'http-referer': 'https://pi.dev',
      'x-openrouter-title': 'pi',
      'x-openrouter-categories': 'cli-agent',
    })
  })
})
