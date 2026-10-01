import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { collectSettingsPatchWrites } from '../persistence-plan'
import {
  resolveNextSessionTitleSettings,
  resolveStoredSessionTitleSettings,
} from '../session-title-settings'
import { buildNextSettingsSnapshot } from '../snapshot'

describe('Title model settings', () => {
  it('defaults to Automatic and ignores an invalid stored value', () => {
    expect(resolveStoredSessionTitleSettings({})).toEqual({ sessionTitleModel: 'automatic' })
    expect(resolveStoredSessionTitleSettings({ sessionTitleModel: 'not-a-model' })).toEqual({
      sessionTitleModel: 'automatic',
    })
    expect(resolveStoredSessionTitleSettings({ sessionTitleModel: 'off' })).toEqual({
      sessionTitleModel: 'off',
    })
  })

  it('applies a valid update and persists only a changed value', () => {
    const model = SupportedModelId('openai/gpt-nano')
    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, { sessionTitleModel: model })

    expect(next.sessionTitleModel).toBe(model)
    expect(collectSettingsPatchWrites({ sessionTitleModel: model }, next)).toEqual([
      { key: 'sessionTitleModel', value: model },
    ])
    expect(collectSettingsPatchWrites({}, next)).toEqual([])
    expect(resolveNextSessionTitleSettings(next, {})).toEqual({ sessionTitleModel: model })
  })
})
