import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

import { usePreferencesStore } from '../preferences-store'

describe('usage statistics preference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.updateSettings.mockResolvedValue({ ok: true })
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS, isLoaded: true, loadError: null })
  })

  it('persists the switch through one typed settings patch', async () => {
    await usePreferencesStore.getState().setUsageStatisticsEnabled(false)

    expect(apiMock.updateSettings).toHaveBeenCalledWith({ usageStatisticsEnabled: false })
    expect(usePreferencesStore.getState().settings.usageStatisticsEnabled).toBe(false)
  })

  it('keeps the saved value when the Session Host rejects the change', async () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, usageStatisticsEnabled: false },
    })
    apiMock.updateSettings.mockResolvedValueOnce({ ok: false, error: 'Host rejected settings' })

    await expect(usePreferencesStore.getState().setUsageStatisticsEnabled(true)).rejects.toThrow(
      'Host rejected settings',
    )
    expect(usePreferencesStore.getState().settings.usageStatisticsEnabled).toBe(false)
  })
})
