import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it } from 'vitest'
import { collectSettingsPatchWrites } from '../persistence-plan'
import { buildNextSettingsSnapshot, buildSettingsSnapshot } from '../snapshot'

describe('Provider restrictions in settings', () => {
  it('keeps stored scopes and drops anything a scope cannot carry', () => {
    const { settings } = buildSettingsSnapshot({
      providerRestrictions: { 'amazon-bedrock': false },
      providerRestrictionsByPath: {
        '/projects/DTD': { only: ['amazon-bedrock'] },
        '/projects/personal': { openrouter: true, 'anthropic)': 'nope', '': true },
        '/projects/bad': { 'amazon-bedrock': 'nope' },
      },
    })

    expect(settings.providerRestrictions).toEqual({ 'amazon-bedrock': false })
    expect(settings.providerRestrictionsByPath).toEqual({
      '/projects/DTD': { only: ['amazon-bedrock'] },
      '/projects/personal': { openrouter: true },
    })
  })

  it('writes changed scopes and leaves other settings alone', () => {
    const partial = {
      providerRestrictions: { 'amazon-bedrock': false },
      providerRestrictionsByPath: { '/projects/DTD': { only: ['amazon-bedrock'] } },
    }
    const next = buildNextSettingsSnapshot(DEFAULT_SETTINGS, partial)

    expect(next.providerRestrictions).toEqual({ 'amazon-bedrock': false })
    expect(next.providerRestrictionsByPath).toEqual({
      '/projects/DTD': { only: ['amazon-bedrock'] },
    })
    expect(collectSettingsPatchWrites(partial, next)).toEqual([
      { key: 'providerRestrictions', value: { 'amazon-bedrock': false } },
      {
        key: 'providerRestrictionsByPath',
        value: { '/projects/DTD': { only: ['amazon-bedrock'] } },
      },
    ])
  })

  it('resolves each scope entry and drops a scope whose entries all fail', () => {
    const { settings } = buildSettingsSnapshot({
      providerRestrictionsByPath: { '/projects/empty': { weird: 1 } },
    })

    expect(settings.providerRestrictionsByPath).toEqual({})
  })
})
