import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSettingsMock, updateSettingsMock, initializeSettingsStoreMock, flushSettingsStoreMock } =
  vi.hoisted(() => ({
    getSettingsMock: vi.fn(),
    updateSettingsMock: vi.fn(),
    initializeSettingsStoreMock: vi.fn(),
    flushSettingsStoreMock: vi.fn(),
  }))

vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
  initializeSettingsStore: initializeSettingsStoreMock,
  flushSettingsStoreForTests: flushSettingsStoreMock,
}))

import { SettingsService } from '../settings-service'

describe('SettingsService.Live', () => {
  beforeEach(() => {
    getSettingsMock.mockReset()
    updateSettingsMock.mockReset()
    initializeSettingsStoreMock.mockReset()
    flushSettingsStoreMock.mockReset()
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
    expect(getSettingsMock).toHaveBeenCalledOnce()
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

  it('delegates initialize to initializeSettingsStore()', async () => {
    initializeSettingsStoreMock.mockResolvedValue(undefined)

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.initialize()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(initializeSettingsStoreMock).toHaveBeenCalledOnce()
  })

  it('delegates flushForTests to flushSettingsStoreForTests()', async () => {
    flushSettingsStoreMock.mockResolvedValue(undefined)

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.flushForTests()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(flushSettingsStoreMock).toHaveBeenCalledOnce()
  })
})
