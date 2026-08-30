import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSettingsMock,
  updateSettingsDurablyMock,
  updateSkillToggleDurablyMock,
  initializeSettingsStoreMock,
  refreshSettingsStoreMock,
  flushSettingsStoreMock,
  isAppDatabaseClientIsolatedMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  updateSettingsDurablyMock: vi.fn(),
  updateSkillToggleDurablyMock: vi.fn(),
  initializeSettingsStoreMock: vi.fn(),
  refreshSettingsStoreMock: vi.fn(),
  flushSettingsStoreMock: vi.fn(),
  isAppDatabaseClientIsolatedMock: vi.fn(() => false),
}))

vi.mock('../database-service', () => ({
  isAppDatabaseClientIsolated: isAppDatabaseClientIsolatedMock,
}))

vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
  updateSettingsDurably: updateSettingsDurablyMock,
  updateSkillToggleDurably: updateSkillToggleDurablyMock,
  initializeSettingsStore: initializeSettingsStoreMock,
  refreshSettingsStore: refreshSettingsStoreMock,
  flushSettingsStoreForTests: flushSettingsStoreMock,
}))

import { SettingsService } from '../settings-service'

describe('SettingsService.Live', () => {
  beforeEach(() => {
    getSettingsMock.mockReset()
    updateSettingsDurablyMock.mockReset()
    updateSkillToggleDurablyMock.mockReset()
    initializeSettingsStoreMock.mockReset()
    refreshSettingsStoreMock.mockReset()
    flushSettingsStoreMock.mockReset()
    isAppDatabaseClientIsolatedMock.mockReset().mockReturnValue(false)
    updateSettingsDurablyMock.mockResolvedValue(undefined)
    updateSkillToggleDurablyMock.mockResolvedValue(undefined)
    refreshSettingsStoreMock.mockResolvedValue(undefined)
  })

  it('keeps the Host-hydrated cache when this GUI uses an isolated database', async () => {
    isAppDatabaseClientIsolatedMock.mockReturnValue(true)
    getSettingsMock.mockReturnValue(DEFAULT_SETTINGS)

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        return yield* service.get()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(refreshSettingsStoreMock).not.toHaveBeenCalled()
    expect(getSettingsMock).toHaveBeenCalledOnce()
  })

  it('refreshes durable state before delegating get to getSettings()', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      selectedModel: SupportedModelId('anthropic/claude-sonnet-4-5'),
    }
    getSettingsMock.mockReturnValue(settings)
    refreshSettingsStoreMock.mockResolvedValue(undefined)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        return yield* service.get()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(result).toBe(settings)
    expect(refreshSettingsStoreMock).toHaveBeenCalledOnce()
    expect(getSettingsMock).toHaveBeenCalledOnce()
  })

  it('delegates update to updateSettingsDurably()', async () => {
    const partial = { selectedModel: SupportedModelId('openai/gpt-4o') }

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.update(partial)
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(updateSettingsDurablyMock).toHaveBeenCalledWith(partial)
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
