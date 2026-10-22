import { pathToFileURL } from 'node:url'
import { setClientIdentityTransform } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../../env'
import { createPiRuntimeServices } from '../pi-provider-catalog'
import { createTempProject, fs, path } from './pi-provider-catalog.test-utils'

const temporaryDirectories: string[] = []

async function temporaryProject() {
  const projectPath = await createTempProject()
  temporaryDirectories.push(projectPath)
  return projectPath
}

beforeEach(async () => {
  const home = await temporaryProject()
  vi.stubEnv('HOME', home)
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(home, '.pi', 'agent'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

// Pi does not export the function it builds each request's identity with (sdk.js,
// `buildRequestOptions`), so the test reads it from Pi's own module.
const PI_CLIENT_IDENTITY_MODULE = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/core/client-identity.js',
)

/** The identity of a Pi request from a fresh project runtime. */
async function runtimeRequestIdentity() {
  const services = await createPiRuntimeServices(await temporaryProject())
  const piModule: unknown = await import(pathToFileURL(PI_CLIENT_IDENTITY_MODULE).href)
  const getClientIdentity: unknown =
    typeof piModule === 'object' && piModule !== null
      ? Reflect.get(piModule, 'getClientIdentity')
      : undefined
  if (typeof getClientIdentity !== 'function') throw new Error('Pi client identity moved')
  const identity: unknown = Reflect.apply(getClientIdentity, undefined, [services.settingsManager])
  if (typeof identity !== 'object' || identity === null) throw new Error('No Pi client identity')
  return identity
}

describe('provider attribution registration', () => {
  beforeEach(() => {
    // Pi's own install telemetry on, so only OpenWaggle's attribution can remove Pi's labels.
    vi.stubEnv('PI_TELEMETRY', '1')
  })

  afterEach(() => {
    setClientIdentityTransform(undefined)
  })

  it('installs OpenWaggle attribution for every project runtime', async () => {
    // Usage statistics are off in tests (a Dev build), so requests carry no attribution.
    expect(await runtimeRequestIdentity()).toMatchObject({ attribution: null })
  })

  it('keeps provider attribution during non-disruptive automation', async () => {
    Object.assign(env, { OPENWAGGLE_AUTOMATION: '1' })
    try {
      expect(await runtimeRequestIdentity()).toMatchObject({ attribution: null })
    } finally {
      Reflect.deleteProperty(env, 'OPENWAGGLE_AUTOMATION')
    }
  })
})
