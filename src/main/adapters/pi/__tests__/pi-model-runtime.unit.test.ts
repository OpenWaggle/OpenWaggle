import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderOAuthService } from '../../../ports/provider-oauth-service'

const calls = vi.hoisted((): string[] => [])

vi.mock('@earendil-works/pi-ai/bun-oauth', () => ({
  registerBunOAuthFlows: () => calls.push('register OAuth flows'),
}))
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()),
  ModelRuntime: {
    create: async () => {
      calls.push('create ModelRuntime')
      return { getProviders: () => [] }
    },
  },
}))

const MAIN_ROOT = path.resolve(__dirname, '../../..')
const CHOKEPOINT = path.join(MAIN_ROOT, 'adapters/pi/pi-model-runtime.ts')

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionSources(file)
    return /\.tsx?$/u.test(entry.name) ? [file] : []
  })
}

describe('the Pi ModelRuntime chokepoint', () => {
  beforeEach(() => {
    calls.length = 0
    vi.resetModules()
  })

  it('registers the bundled OAuth flows before Pi builds a ModelRuntime', async () => {
    const { createPiModelRuntime } = await import('../pi-model-runtime')

    await createPiModelRuntime()
    await createPiModelRuntime()

    expect(calls).toEqual(['register OAuth flows', 'create ModelRuntime', 'create ModelRuntime'])
  })

  it("registers them on the desktop window's own OAuth path, which loads no Host runtime", async () => {
    const { LazyPiProviderOAuthLive } = await import('../gui-lazy-pi-services')

    await Effect.runPromise(
      Effect.flatMap(ProviderOAuthService, (service) => service.listProviders()).pipe(
        Effect.provide(LazyPiProviderOAuthLive),
      ),
    )

    expect(calls).toEqual(['register OAuth flows', 'create ModelRuntime'])
  })

  it('is the only place OpenWaggle builds a ModelRuntime', () => {
    const builders = productionSources(MAIN_ROOT).filter(
      (file) => file !== CHOKEPOINT && readFileSync(file, 'utf8').includes('ModelRuntime.create('),
    )

    expect(builders.map((file) => path.relative(MAIN_ROOT, file))).toEqual([])
  })
})
