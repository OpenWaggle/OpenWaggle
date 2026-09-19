import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  browserPreviewAutomationDefaults,
  createBrowserPreviewAutomationAccessGuard,
} from '../../adapters/electron-browser-preview-automation-effects'

const {
  invokeHostMock,
  getSettingsMock,
  hydrateSettingsMock,
  initializeSettingsMock,
  refreshSettingsMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  invokeHostMock: vi.fn(),
  getSettingsMock: vi.fn(),
  hydrateSettingsMock: vi.fn(),
  initializeSettingsMock: vi.fn(),
  refreshSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}))

vi.mock('../database-service', () => ({ isAppDatabaseClientIsolated: () => true }))
vi.mock('../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUi: invokeHostMock,
}))
vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
  hydrateSettingsStoreFromHost: hydrateSettingsMock,
  initializeSettingsStore: initializeSettingsMock,
  refreshSettingsStore: refreshSettingsMock,
  updateSettingsDurably: updateSettingsMock,
  updateSkillToggleDurably: vi.fn(),
  flushSettingsStoreForTests: vi.fn(),
}))

import { SettingsService } from '../settings-service'

describe('attached GUI settings used by native browser services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSettingsMock.mockReturnValue(DEFAULT_SETTINGS)
    hydrateSettingsMock.mockImplementation((snapshot: Settings) => {
      getSettingsMock.mockReturnValue(snapshot)
    })
    invokeHostMock.mockResolvedValue({ handled: true, result: DEFAULT_SETTINGS })
  })

  it('applies an access revocation from the Host before the next native browser operation', async () => {
    let hostSettings: Settings = { ...DEFAULT_SETTINGS, enableAgentBrowserAccess: true }
    getSettingsMock.mockReturnValue(hostSettings)
    invokeHostMock.mockImplementation(async () => ({ handled: true, result: hostSettings }))
    const nativeOperation = vi.fn()

    await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* SettingsService
        const guard = createBrowserPreviewAutomationAccessGuard(settings)
        yield* guard(Effect.sync(nativeOperation))
        hostSettings = { ...hostSettings, enableAgentBrowserAccess: false }
        const denied = yield* Effect.either(guard(Effect.sync(nativeOperation)))
        expect(denied).toMatchObject({ _tag: 'Left' })
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(nativeOperation).toHaveBeenCalledOnce()
    expect(updateSettingsMock).not.toHaveBeenCalled()
    expect(refreshSettingsMock).not.toHaveBeenCalled()
  })

  it('uses changed Host profile and visibility defaults without restarting the GUI', async () => {
    invokeHostMock.mockResolvedValue({
      handled: true,
      result: {
        ...DEFAULT_SETTINGS,
        browserDefaultProfileId: 'incognito',
        browserAutoShowFloatingPreview: false,
      } satisfies Settings,
    })
    const defaults = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* browserPreviewAutomationDefaults(yield* SettingsService)
      }).pipe(Effect.provide(SettingsService.Live)),
    )

    expect(defaults).toEqual({ profileId: 'incognito', autoShow: false })
    expect(initializeSettingsMock).not.toHaveBeenCalled()
  })

  it.each(['unavailable', 'route-lost'])(
    'denies native browser access when Host settings are %s instead of using the startup grant',
    async (failure) => {
      if (failure === 'unavailable') invokeHostMock.mockRejectedValue(new Error('Host unavailable'))
      else invokeHostMock.mockResolvedValue({ handled: false })
      getSettingsMock.mockReturnValue({ ...DEFAULT_SETTINGS, enableAgentBrowserAccess: true })
      const nativeOperation = vi.fn()
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const guard = createBrowserPreviewAutomationAccessGuard(yield* SettingsService)
            return yield* guard(Effect.sync(nativeOperation))
          }).pipe(Effect.provide(SettingsService.Live)),
        ),
      ).rejects.toThrow('Agent browser access could not be verified.')
      expect(nativeOperation).not.toHaveBeenCalled()
    },
  )
})
