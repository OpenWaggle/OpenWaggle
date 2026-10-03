import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { CURRENT_SETTINGS_KEYS, SETTINGS_KEY_USAGE_STATISTICS_ENABLED } from '../keys'
import { validatePersistedSettings } from '../persisted-validation'
import { collectSettingsPatchWrites } from '../persistence-plan'
import { buildNextSettingsSnapshot, buildSettingsSnapshot } from '../snapshot'

describe('usage statistics settings', () => {
  it('is a current persisted key that defaults to on (ADR 0046)', () => {
    expect(CURRENT_SETTINGS_KEYS).toContain(SETTINGS_KEY_USAGE_STATISTICS_ENABLED)
    expect(DEFAULT_SETTINGS.usageStatisticsEnabled).toBe(true)
    expect(buildSettingsSnapshot({}).settings.usageStatisticsEnabled).toBe(true)
  })

  it('reads a saved opt-out', () => {
    const settings = buildSettingsSnapshot({
      [SETTINGS_KEY_USAGE_STATISTICS_ENABLED]: false,
    }).settings

    expect(settings.usageStatisticsEnabled).toBe(false)
  })

  it('persists an explicit change and nothing else', () => {
    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, { usageStatisticsEnabled: false })

    expect(next.usageStatisticsEnabled).toBe(false)
    expect(collectSettingsPatchWrites({ usageStatisticsEnabled: false }, next)).toEqual([
      { key: SETTINGS_KEY_USAGE_STATISTICS_ENABLED, value: false },
    ])
  })

  it('keeps the current value when a patch does not touch it', () => {
    const current = { ...DEFAULT_SETTINGS, usageStatisticsEnabled: false }
    const next = buildNextSettingsSnapshot(current, { diffWrapLines: true })

    expect(next.usageStatisticsEnabled).toBe(false)
    expect(collectSettingsPatchWrites({ diffWrapLines: true }, next)).not.toContainEqual(
      expect.objectContaining({ key: SETTINGS_KEY_USAGE_STATISTICS_ENABLED }),
    )
  })

  it('rejects a present non-boolean value instead of turning statistics back on', () => {
    expect(() =>
      validatePersistedSettings({ [SETTINGS_KEY_USAGE_STATISTICS_ENABLED]: 'false' }),
    ).toThrow(/usageStatisticsEnabled/u)
  })
})
