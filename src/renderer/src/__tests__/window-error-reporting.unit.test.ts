import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({ api: { getSettings: vi.fn(), updateSettings: vi.fn() } }))

import { usePreferencesStore } from '@/features/settings/state'
import { windowUsageStatistics } from '../window-error-reporting'

describe("this window's Usage statistics Setting", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS, isLoaded: false, loadError: null })
  })

  it('counts as off until Settings load, and when they failed to load', () => {
    expect(windowUsageStatistics.isEnabled()).toBe(false)

    usePreferencesStore.setState({ isLoaded: true, loadError: 'Failed to load settings' })
    expect(windowUsageStatistics.isEnabled()).toBe(false)

    usePreferencesStore.setState({ loadError: null })
    expect(windowUsageStatistics.isEnabled()).toBe(true)
  })

  it('follows the switch and reports each change', () => {
    usePreferencesStore.setState({ isLoaded: true })
    const listener = vi.fn()
    const unsubscribe = windowUsageStatistics.subscribe(listener)

    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, usageStatisticsEnabled: false },
    })
    expect(windowUsageStatistics.isEnabled()).toBe(false)
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
    expect(windowUsageStatistics.isEnabled()).toBe(true)
    unsubscribe()
    usePreferencesStore.setState({ isLoaded: false })

    expect(listener).toHaveBeenCalledTimes(2)
  })
})
