import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { collectSettingsPatchWrites } from '../settings/persistence-plan'
import { buildNextSettingsSnapshot, buildSettingsSnapshot } from '../settings/snapshot'

describe('Session Host settings', () => {
  it('loads valid user and project limits without imposing the default of four', () => {
    const result = buildSettingsSnapshot({
      sessionHostParentConcurrencyLimit: 12,
      sessionHostParentConcurrencyLimitsByProject: {
        ' /project ': 24,
        '/invalid': 0,
      },
      sessionHostRunCeiling: 64,
      sessionHostIdleGracePeriodMs: 0,
      multiAgentEnabled: false,
      multiAgentEnabledByProject: { ' /project ': true, '/invalid': 'yes' },
    }).settings

    expect(result).toMatchObject({
      sessionHostParentConcurrencyLimit: 12,
      sessionHostParentConcurrencyLimitsByProject: { '/project': 24 },
      sessionHostRunCeiling: 64,
      sessionHostIdleGracePeriodMs: 0,
      multiAgentEnabled: false,
      multiAgentEnabledByProject: { '/project': true },
    })
  })

  it('falls back for invalid scalar limits and persists only requested Host changes', () => {
    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, {
      sessionHostParentConcurrencyLimit: -1,
      sessionHostRunCeiling: 32,
    })
    const writes = collectSettingsPatchWrites(
      { sessionHostParentConcurrencyLimit: -1, sessionHostRunCeiling: 32 },
      next,
    )

    expect(next.sessionHostParentConcurrencyLimit).toBe(
      DEFAULT_SETTINGS.sessionHostParentConcurrencyLimit,
    )
    expect(writes).toEqual([
      {
        key: 'sessionHostParentConcurrencyLimit',
        value: DEFAULT_SETTINGS.sessionHostParentConcurrencyLimit,
      },
      { key: 'sessionHostRunCeiling', value: 32 },
    ])
  })
})
