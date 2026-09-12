import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStoreReadError } from '../../errors'

const {
  getSettingsMock,
  updateSettingsMock,
  updateSettingsDurablyMock,
  initializeSettingsStoreMock,
  flushSettingsStoreMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  updateSettingsDurablyMock: vi.fn(),
  initializeSettingsStoreMock: vi.fn(),
  flushSettingsStoreMock: vi.fn(),
}))

vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
  updateSettingsDurably: updateSettingsDurablyMock,
  initializeSettingsStore: initializeSettingsStoreMock,
  flushSettingsStoreForTests: flushSettingsStoreMock,
}))

import { SettingsService } from '../settings-service'

describe('SettingsService.Live', () => {
  beforeEach(() => {
    getSettingsMock.mockReset()
    updateSettingsMock.mockReset()
    updateSettingsDurablyMock.mockReset()
    initializeSettingsStoreMock.mockReset()
    flushSettingsStoreMock.mockReset()
    initializeSettingsStoreMock.mockResolvedValue(undefined)
    flushSettingsStoreMock.mockResolvedValue(undefined)
  })

  it('delegates get to getSettings()', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
    }
    getSettingsMock.mockReturnValue(settings)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        return yield* service.get()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(result).toBe(settings)
    expect(initializeSettingsStoreMock).toHaveBeenCalledOnce()
    expect(getSettingsMock).toHaveBeenCalledOnce()
  })

  it('surfaces a typed settings read failure and retries on the next get', async () => {
    const failure = new SettingsStoreReadError({
      operation: 'decode',
      message: 'Saved browser settings are invalid.',
    })
    getSettingsMock.mockImplementationOnce(() => {
      throw failure
    })
    getSettingsMock.mockReturnValueOnce(DEFAULT_SETTINGS)

    const read = () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SettingsService
          return yield* service.get()
        }).pipe(Effect.provide(SettingsService.Live)),
      )

    await expect(read()).rejects.toThrow('Saved browser settings are invalid.')
    await expect(read()).resolves.toBe(DEFAULT_SETTINGS)
    expect(initializeSettingsStoreMock).toHaveBeenCalledTimes(2)
  })

  it('does not write before a settings read succeeds', async () => {
    getSettingsMock.mockImplementation(() => {
      throw new SettingsStoreReadError({
        operation: 'read',
        message: 'Settings database unavailable.',
      })
    })

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SettingsService
          yield* service.update({ thinkingLevel: 'high' })
        }).pipe(Effect.provide(SettingsService.Live)),
      ),
    ).rejects.toThrow('Settings database unavailable')
    expect(updateSettingsMock).not.toHaveBeenCalled()
    expect(updateSettingsDurablyMock).not.toHaveBeenCalled()
  })

  it('delegates update to updateSettings()', async () => {
    const partial = { selectedModel: SupportedModelId('openai/gpt-4o') }

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.update(partial)
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(updateSettingsMock).toHaveBeenCalledWith(partial)
  })

  it('awaits durable persistence for browser profile updates', async () => {
    const partial = {
      browserProfiles: [{ id: 'work', name: 'Work', kind: 'persistent' as const }],
    }
    updateSettingsDurablyMock.mockResolvedValue(undefined)

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.update(partial)
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(updateSettingsDurablyMock).toHaveBeenCalledWith(partial)
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('surfaces durable browser profile persistence failures', async () => {
    const failure = new Error('settings database unavailable')
    updateSettingsDurablyMock.mockRejectedValue(failure)

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SettingsService
          yield* service.update({
            browserProfiles: [{ id: 'work', name: 'Work', kind: 'persistent' }],
          })
        }).pipe(Effect.provide(SettingsService.Live)),
      ),
    ).rejects.toThrow('settings database unavailable')
  })

  it('delegates initialize to initializeSettingsStore()', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.initialize()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(initializeSettingsStoreMock).toHaveBeenCalledOnce()
  })

  it('delegates flushForTests to flushSettingsStoreForTests()', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.flushForTests()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(flushSettingsStoreMock).toHaveBeenCalledOnce()
  })
})
