import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import {
  SETTINGS_KEY_BROWSER_DEFAULT_PROFILE_ID,
  SETTINGS_KEY_BROWSER_PROFILES,
  SETTINGS_KEY_ENABLE_AGENT_BROWSER_ACCESS,
} from '../keys'
import { collectSettingsPatchWrites } from '../persistence-plan'
import { buildNextSettingsSnapshot, buildSettingsSnapshot } from '../snapshot'

describe('browser profile settings', () => {
  it('sanitizes user profiles and falls back when the stored default is missing', () => {
    const result = buildSettingsSnapshot({
      [SETTINGS_KEY_BROWSER_PROFILES]: [
        { id: 'work', name: 'Work', kind: 'persistent' },
        { id: 'work', name: 'Duplicate', kind: 'persistent' },
        { id: 'incognito', name: 'Override', kind: 'persistent' },
        { id: 'bad\nprofile', name: 'Bad', kind: 'persistent' },
      ],
      [SETTINGS_KEY_BROWSER_DEFAULT_PROFILE_ID]: 'missing',
    }).settings

    expect(result.browserProfiles).toEqual([{ id: 'work', name: 'Work', kind: 'persistent' }])
    expect(result.browserDefaultProfileId).toBe('default')
  })

  it('mirrors T3 agent-browser access default and persists an explicit opt-out', () => {
    expect(buildSettingsSnapshot({}).settings.enableAgentBrowserAccess).toBe(true)
    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, {
      enableAgentBrowserAccess: false,
    })

    expect(next.enableAgentBrowserAccess).toBe(false)
    expect(collectSettingsPatchWrites({ enableAgentBrowserAccess: false }, next)).toContainEqual({
      key: SETTINGS_KEY_ENABLE_AGENT_BROWSER_ACCESS,
      value: false,
    })
  })

  it('repairs the default profile atomically when that custom profile is deleted', () => {
    const current = {
      ...DEFAULT_SETTINGS,
      browserProfiles: [{ id: 'work', name: 'Work', kind: 'persistent' as const }],
      browserDefaultProfileId: 'work',
    }
    const next = buildNextSettingsSnapshot(current, { browserProfiles: [] })

    expect(next.browserProfiles).toEqual([])
    expect(next.browserDefaultProfileId).toBe('default')
    expect(collectSettingsPatchWrites({ browserProfiles: [] }, next)).toEqual(
      expect.arrayContaining([
        { key: SETTINGS_KEY_BROWSER_PROFILES, value: [] },
        { key: SETTINGS_KEY_BROWSER_DEFAULT_PROFILE_ID, value: 'default' },
      ]),
    )
  })
})
