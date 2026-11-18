import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getHostAfterRemote,
  getSettingsMock,
  loadSettingsHandlers,
  resetSettingsHandlerMocks,
} from './settings-handler.test-harness'

describe('settings:update from an attached GUI', () => {
  let registerSettingsHandlers: Awaited<
    ReturnType<typeof loadSettingsHandlers>
  >['registerSettingsHandlers']
  /** What the attached GUI holds; the Settings service read hydrates it from the Host. */
  let guiSettings: Settings

  beforeEach(async () => {
    resetSettingsHandlerMocks()
    guiSettings = DEFAULT_SETTINGS
    const hostSettings: Settings = { ...DEFAULT_SETTINGS, usageStatisticsEnabled: false }
    getSettingsMock.mockImplementation(() => {
      guiSettings = hostSettings
      return hostSettings
    })
    ;({ registerSettingsHandlers } = await loadSettingsHandlers())
  })

  it('takes the Host value at once after a successful usage statistics change', async () => {
    registerSettingsHandlers()
    const afterRemote = getHostAfterRemote('settings:update')

    await afterRemote?.({ ok: true }, { usageStatisticsEnabled: false })

    expect(afterRemote).toBeDefined()
    expect(guiSettings.usageStatisticsEnabled).toBe(false)
  })

  it('leaves the GUI as it was after other settings or a rejected update', async () => {
    registerSettingsHandlers()
    const afterRemote = getHostAfterRemote('settings:update')

    await afterRemote?.({ ok: true }, { diffWrapLines: true })
    await afterRemote?.({ ok: false, error: 'rejected' }, { usageStatisticsEnabled: false })

    expect(afterRemote).toBeDefined()
    expect(guiSettings).toBe(DEFAULT_SETTINGS)
  })
})
