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

async function providerHeaderHandlers() {
  const services = await createPiRuntimeServices(await temporaryProject())
  return services.resourceLoader
    .getExtensions()
    .extensions.flatMap((extension) => extension.handlers.get('before_provider_headers') ?? [])
}

async function headersAfterHandlers(handlers: Awaited<ReturnType<typeof providerHeaderHandlers>>) {
  const headers: Record<string, string | null> = {
    'HTTP-Referer': 'https://pi.dev',
    'X-OpenRouter-Title': 'pi',
    'X-OpenRouter-Categories': 'cli-agent',
    Authorization: 'Bearer sk-secret',
  }
  for (const handler of handlers) await handler({ type: 'before_provider_headers', headers }, {})
  return headers
}

describe('provider attribution registration', () => {
  it('loads the provider attribution extension into every project runtime', async () => {
    const handlers = await providerHeaderHandlers()

    expect(handlers).toHaveLength(1)
    // Usage statistics are off in tests (a Dev build), so Pi's labels are removed.
    expect(await headersAfterHandlers(handlers)).toEqual({ Authorization: 'Bearer sk-secret' })
  })

  it('keeps provider attribution during non-disruptive automation', async () => {
    Object.assign(env, { OPENWAGGLE_AUTOMATION: '1' })
    try {
      const handlers = await providerHeaderHandlers()

      expect(handlers).toHaveLength(1)
      expect(await headersAfterHandlers(handlers)).toEqual({ Authorization: 'Bearer sk-secret' })
    } finally {
      Reflect.deleteProperty(env, 'OPENWAGGLE_AUTOMATION')
    }
  })
})
