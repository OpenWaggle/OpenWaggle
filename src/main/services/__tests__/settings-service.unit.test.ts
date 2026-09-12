import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsStoreReadError } from '../../errors'

const {
  getSettingsMock,
  updateSettingsDurablyMock,
  updateSkillToggleDurablyMock,
  initializeSettingsStoreMock,
  refreshSettingsStoreMock,
  flushSettingsStoreMock,
  isAppDatabaseClientIsolatedMock,
  invokeConfiguredHostUiMock,
  hydrateSettingsStoreFromHostMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  updateSettingsDurablyMock: vi.fn(),
  updateSkillToggleDurablyMock: vi.fn(),
  initializeSettingsStoreMock: vi.fn(),
  refreshSettingsStoreMock: vi.fn(),
  flushSettingsStoreMock: vi.fn(),
  isAppDatabaseClientIsolatedMock: vi.fn(() => false),
  invokeConfiguredHostUiMock: vi.fn(),
  hydrateSettingsStoreFromHostMock: vi.fn(),
}))

vi.mock('../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: invokeConfiguredHostUiMock,
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
  hydrateSettingsStoreFromHost: hydrateSettingsStoreFromHostMock,
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
    invokeConfiguredHostUiMock
      .mockReset()
      .mockResolvedValue({ handled: true, result: DEFAULT_SETTINGS })
    hydrateSettingsStoreFromHostMock.mockReset()
    updateSettingsDurablyMock.mockResolvedValue(undefined)
    updateSkillToggleDurablyMock.mockResolvedValue(undefined)
    refreshSettingsStoreMock.mockResolvedValue(undefined)
    initializeSettingsStoreMock.mockResolvedValue(undefined)
    flushSettingsStoreMock.mockResolvedValue(undefined)
    getSettingsMock.mockReturnValue(DEFAULT_SETTINGS)
  })

  it('refreshes the Host snapshot without reading the GUI isolated database', async () => {
    isAppDatabaseClientIsolatedMock.mockReturnValue(true)
    getSettingsMock.mockReturnValue(DEFAULT_SETTINGS)

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        return yield* service.get()
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(refreshSettingsStoreMock).not.toHaveBeenCalled()
    expect(initializeSettingsStoreMock).not.toHaveBeenCalled()
    expect(getSettingsMock).toHaveBeenCalledOnce()
    expect(invokeConfiguredHostUiMock).toHaveBeenCalledWith('settings:get', [])
    expect(hydrateSettingsStoreFromHostMock).toHaveBeenCalledWith(DEFAULT_SETTINGS)
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
    expect(updateSettingsDurablyMock).not.toHaveBeenCalled()
  })

  it('delegates every update to updateSettingsDurably()', async () => {
    const partial = { selectedModel: SupportedModelId('openai/gpt-4o') }

    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        yield* service.update(partial)
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(updateSettingsDurablyMock).toHaveBeenCalledWith(partial)
  })

  it('delegates skill updates to the atomic durable toggle operation', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SettingsService
        if (service.setSkillEnabled === undefined) throw new Error('Missing atomic skill updates')
        yield* service.setSkillEnabled('/tmp/project', 'review', false)
      }).pipe(Effect.provide(SettingsService.Live)),
    )
    expect(updateSkillToggleDurablyMock).toHaveBeenCalledWith('/tmp/project', 'review', false)
    expect(updateSettingsDurablyMock).not.toHaveBeenCalled()
  })

  it('does not replace missing GUI hydration with isolated database defaults', async () => {
    isAppDatabaseClientIsolatedMock.mockReturnValue(true)
    getSettingsMock.mockImplementation(() => {
      throw new SettingsStoreReadError({ operation: 'read', message: 'Host settings not ready.' })
    })
    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* SettingsService
          yield* service.initialize()
        }).pipe(Effect.provide(SettingsService.Live)),
      ),
    ).rejects.toThrow('Host settings not ready.')
    expect(initializeSettingsStoreMock).not.toHaveBeenCalled()
    expect(refreshSettingsStoreMock).not.toHaveBeenCalled()
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
