import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMock, getAllMock, getProviderForModelMock, isKnownModelMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  getAllMock: vi.fn(),
  getProviderForModelMock: vi.fn(),
  isKnownModelMock: vi.fn(),
}))

vi.mock('../../providers/registry', () => ({
  providerRegistry: {
    get: getMock,
    getAll: getAllMock,
    getProviderForModel: getProviderForModelMock,
    isKnownModel: isKnownModelMock,
  },
}))

import { ProviderRegistryService } from '../provider-registry-service'

describe('ProviderRegistryService.Live', () => {
  beforeEach(() => {
    getMock.mockReset()
    getAllMock.mockReset()
    getProviderForModelMock.mockReset()
    isKnownModelMock.mockReset()
  })

  it('delegates get, getAll, and isKnownModel to the registry', async () => {
    const provider = { id: 'anthropic' }
    const providers = [provider]
    getMock.mockReturnValue(provider)
    getAllMock.mockReturnValue(providers)
    isKnownModelMock.mockReturnValue(true)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ProviderRegistryService
        return {
          provider: yield* service.get('anthropic'),
          providers: yield* service.getAll(),
          known: yield* service.isKnownModel('claude-sonnet-4-5'),
        }
      }).pipe(Effect.provide(ProviderRegistryService.Live)),
    )

    expect(result).toEqual({
      provider,
      providers,
      known: true,
    })
  })

  it('fails with ProviderLookupError when the model is unknown', async () => {
    getProviderForModelMock.mockReturnValue(undefined)

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const service = yield* ProviderRegistryService
        return yield* service.getProviderForModel('missing-model')
      }).pipe(Effect.provide(ProviderRegistryService.Live)),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause)
      expect(Option.isSome(failure)).toBe(true)
      if (Option.isSome(failure)) {
        expect(failure.value).toMatchObject({
          _tag: 'ProviderLookupError',
          modelId: 'missing-model',
        })
      }
    }
  })
})
