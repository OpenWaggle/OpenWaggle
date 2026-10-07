import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import {
  CURRENT_SETTINGS_KEYS,
  SETTINGS_KEY_CACHE_WARMING,
  SETTINGS_KEY_CODEMODE_ENABLED,
} from '../keys'
import { validatePersistedSettings } from '../persisted-validation'
import { collectSettingsPatchWrites } from '../persistence-plan'
import { buildNextSettingsSnapshot, buildSettingsSnapshot } from '../snapshot'

describe('Pi runtime settings', () => {
  it('turn codemode on and keep prompt caches warm while working by default', () => {
    expect(CURRENT_SETTINGS_KEYS).toEqual(
      expect.arrayContaining([SETTINGS_KEY_CODEMODE_ENABLED, SETTINGS_KEY_CACHE_WARMING]),
    )
    expect(buildSettingsSnapshot({}).settings).toMatchObject({
      codemodeEnabled: true,
      cacheWarming: 'streaming',
    })
  })

  it('read and persist the choices the user made', () => {
    expect(
      buildSettingsSnapshot({
        [SETTINGS_KEY_CODEMODE_ENABLED]: false,
        [SETTINGS_KEY_CACHE_WARMING]: 'off',
      }).settings,
    ).toMatchObject({ codemodeEnabled: false, cacheWarming: 'off' })

    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, {
      codemodeEnabled: false,
      cacheWarming: 'off',
    })
    expect(
      collectSettingsPatchWrites({ codemodeEnabled: false, cacheWarming: 'off' }, next),
    ).toEqual([
      { key: SETTINGS_KEY_CODEMODE_ENABLED, value: false },
      { key: SETTINGS_KEY_CACHE_WARMING, value: 'off' },
    ])
  })

  it('rejects a cache warming mode Pi does not know', () => {
    expect(() => validatePersistedSettings({ [SETTINGS_KEY_CACHE_WARMING]: 'always' })).toThrow()
  })
})
