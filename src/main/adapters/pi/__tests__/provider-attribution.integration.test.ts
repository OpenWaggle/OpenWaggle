import { createAgentSessionFromServices, SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTempProject, fs, path } from './pi-provider-catalog.test-utils'

const statistics = vi.hoisted(() => ({ enabled: true }))

vi.mock('../../../usage-statistics/usage-statistics-enablement', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../usage-statistics/usage-statistics-enablement')
  >()),
  isUsageStatisticsEnabled: () => statistics.enabled,
}))

const { createPiProviderCatalogSnapshot, createPiRuntimeServices } = await import(
  '../pi-provider-catalog'
)
const { setClientIdentityTransform } = await import('@earendil-works/pi-coding-agent')

const ATTRIBUTION_HEADERS = ['http-referer', 'x-openrouter-title', 'x-openrouter-categories']
const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const directory = await createTempProject()
  temporaryDirectories.push(directory)
  return directory
}

/** The OpenRouter attribution headers of each request an agent turn sends. */
function stubProviderFetch() {
  const requests: Record<string, string>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      requests.push(
        Object.fromEntries(
          ATTRIBUTION_HEADERS.flatMap((name) => {
            const value = headers.get(name)
            return value === null ? [] : [[name, value]]
          }),
        ),
      )
      return new Response('{"error":{"message":"stop"}}', { status: 400 })
    }),
  )
  return requests
}

/** Runs one agent turn on an OpenRouter model through OpenWaggle's Pi runtime. */
async function promptOpenRouter(services: Awaited<ReturnType<typeof createPiRuntimeServices>>) {
  const model = services.modelRuntime.getModels('openrouter')[0]
  if (!model) throw new Error('Pi has no OpenRouter model')
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(),
    model,
  })
  try {
    await session.prompt('Hello')
  } finally {
    session.dispose()
  }
}

beforeEach(async () => {
  const home = await temporaryDirectory()
  const agentDir = path.join(home, '.pi', 'agent')
  vi.stubEnv('HOME', home)
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
  vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test')
  // Pi's own install telemetry on, so Pi would add its labels without OpenWaggle's attribution.
  vi.stubEnv('PI_TELEMETRY', '1')
  await fs.mkdir(agentDir, { recursive: true })
  await fs.writeFile(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ retry: { enabled: false }, cacheWarming: 'off' }),
  )
  statistics.enabled = true
})

afterEach(async () => {
  setClientIdentityTransform(undefined)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe('OpenWaggle provider attribution on agent turns', () => {
  it('labels the requests of an agent turn OpenWaggle while Usage statistics are on', async () => {
    const requests = stubProviderFetch()

    await promptOpenRouter(await createPiRuntimeServices(await temporaryDirectory()))

    expect(requests.length).toBeGreaterThan(0)
    for (const headers of requests) {
      expect(headers).toEqual({
        'http-referer': 'https://openwaggle.ai',
        'x-openrouter-title': 'OpenWaggle',
      })
    }
  })

  it("sends none of Pi's attribution on an agent turn while Usage statistics are off", async () => {
    statistics.enabled = false
    const requests = stubProviderFetch()

    await promptOpenRouter(await createPiRuntimeServices(await temporaryDirectory()))

    expect(requests.length).toBeGreaterThan(0)
    for (const headers of requests) expect(headers).toEqual({})
  })

  it('installs the attribution when the global provider catalog builds a runtime', async () => {
    statistics.enabled = false
    const services = await createPiRuntimeServices(await temporaryDirectory())
    // Only the global catalog's own install can now remove Pi's labels.
    setClientIdentityTransform(undefined)
    await createPiProviderCatalogSnapshot(null)
    const requests = stubProviderFetch()

    await promptOpenRouter(services)

    expect(requests.length).toBeGreaterThan(0)
    for (const headers of requests) expect(headers).toEqual({})
  })
})
