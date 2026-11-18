import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { collectSettingsPatchWrites } from '../persistence-plan'
import { buildNextSettingsSnapshot, buildSettingsSnapshot } from '../snapshot'

describe('Pi continuation choices in settings', () => {
  it('keeps each remembered project choice and drops anything else', () => {
    const { settings } = buildSettingsSnapshot({
      piSessionContinuationByProject: {
        '/projects/app': 'pi',
        '/projects/api': 'openwaggle',
        '/projects/odd': 'ask',
        '  ': 'pi',
      },
    })

    expect(settings.piSessionContinuationByProject).toEqual({
      '/projects/app': 'pi',
      '/projects/api': 'openwaggle',
    })
  })

  it('writes a changed choice and leaves other settings alone', () => {
    const partial = { piSessionContinuationByProject: { '/projects/app': 'pi' as const } }
    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, partial)

    expect(next.piSessionContinuationByProject).toEqual({ '/projects/app': 'pi' })
    expect(collectSettingsPatchWrites(partial, next)).toEqual([
      { key: 'piSessionContinuationByProject', value: { '/projects/app': 'pi' } },
    ])
  })
})
