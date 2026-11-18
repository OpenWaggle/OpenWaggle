import type { Settings } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => {
  const state: { listener?: (settings: Settings | undefined) => void } = {}
  return state
})

vi.mock('@shared/build-identity-runtime', () => ({
  BUILD_CHANNEL: 'stable',
  PRODUCT_NAME: 'OpenWaggle',
}))
vi.mock('../../env', () => ({ env: {} }))
vi.mock('../../store/authoritative-settings', () => ({
  onAuthoritativeSettingsChange: (listener: (settings: Settings | undefined) => void) => {
    store.listener = listener
    listener(undefined)
    return () => undefined
  },
}))

import {
  currentUsageStatisticsEnablement,
  isUsageStatisticsEnabled,
  onUsageStatisticsEnablementChange,
} from '../usage-statistics-enablement'

function publish(usageStatisticsEnabled: boolean | undefined) {
  store.listener?.(
    usageStatisticsEnabled === undefined
      ? undefined
      : fromPartial<Settings>({ usageStatisticsEnabled }),
  )
}

describe('Usage statistics enablement in this process', () => {
  it('follows the settings store’s authoritative Settings and is off without them', () => {
    const seen: boolean[] = []
    onUsageStatisticsEnablementChange((enabled) => seen.push(enabled))

    expect(currentUsageStatisticsEnablement()).toEqual({
      enabled: false,
      reason: 'settings-unavailable',
    })
    publish(true)
    expect(isUsageStatisticsEnabled()).toBe(true)
    publish(false)
    expect(currentUsageStatisticsEnablement()).toEqual({ enabled: false, reason: 'setting' })
    publish(undefined)

    expect(seen).toEqual([true, false])
    expect(isUsageStatisticsEnabled()).toBe(false)
  })
})
